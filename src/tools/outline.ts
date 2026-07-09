import path from "node:path";
import { ToolError } from "../errors.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import { readTextFile } from "../lib/textfile.js";
import { countNewlines } from "../lib/text.js";
import {
  MAX_PARSE_BYTES,
  collectSyntaxIssues,
  grammarForPath,
  parseText,
} from "../lib/treesitter.js";
import { OUTLINE_MAX_ENTRIES, OUTLINE_SPECS, extractOutline } from "../lib/outline-spec.js";
import type { ToolDef } from "./types.js";

const OUTLINE_LANGUAGES = "typescript, tsx, javascript, python, go, rust, java, c-sharp";

export const outline: ToolDef = {
  name: "outline",
  description:
    "Return the symbol skeleton of ONE source file: classes, functions, methods and other " +
    "declarations as indented lines with 1-based (start-end) line ranges. Use it to understand " +
    "an unfamiliar file cheaply, then read only the relevant ranges with read_file. Supports " +
    `${OUTLINE_LANGUAGES} (picked by file extension).`,
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Source file to outline. Relative to workspace root or absolute (~ is not expanded).",
      },
    },
    required: ["path"],
  },
  async handler(args, config, signal) {
    const rel = args.path as string;
    const target = resolvePath(rel, config.workspaceRoot, config.confineToWorkspace);

    const grammar = grammarForPath(target);
    const spec = grammar ? OUTLINE_SPECS[grammar] : undefined;
    if (!grammar || !spec) {
      const ext = path.extname(target).toLowerCase();
      const detail = grammar
        ? `outline does not support ${grammar} files (supported: ${OUTLINE_LANGUAGES}); ` +
          `check_syntax does support them.`
        : `outline does not support ${ext ? `'${ext}'` : "extensionless"} files ` +
          `(supported: ${OUTLINE_LANGUAGES}).`;
      throw new ToolError("invalid_input", detail, { path: rel });
    }

    const decoded = await readTextFile(target, rel, config.maxFileBytes);
    if (Buffer.byteLength(decoded.content, "utf8") > MAX_PARSE_BYTES) {
      throw new ToolError(
        "too_large",
        `File exceeds the ${MAX_PARSE_BYTES}-byte parse limit: ${rel}`,
        { path: rel, limit: MAX_PARSE_BYTES },
      );
    }

    const outcome = await parseText(decoded.content, grammar, { signal });
    if (outcome.status === "timeout") {
      throw new ToolError("timeout", `Parsing timed out: ${rel}`, { path: rel });
    }
    if (outcome.status === "aborted") {
      throw new ToolError("aborted", `Parsing aborted: ${rel}`, { path: rel });
    }
    if (outcome.status === "unavailable") {
      throw new ToolError("internal", "tree-sitter runtime failed to load");
    }

    try {
      const root = outcome.tree.rootNode;
      const entries = extractOutline(root, spec);
      const lineCount = countNewlines(decoded.content) + 1;
      const lines = [
        `${displayPath(target, config.workspaceRoot)} — ${grammar}, ${lineCount} lines`,
      ];
      const shown = entries.slice(0, OUTLINE_MAX_ENTRIES);
      for (const entry of shown) {
        lines.push(
          `${"  ".repeat(entry.depth + 1)}${entry.header} (${entry.startLine}-${entry.endLine})`,
        );
      }
      if (shown.length === 0) lines.push("  (no symbols found)");
      if (entries.length > shown.length) {
        lines.push(`  [... ${entries.length - shown.length} more symbols omitted ...]`);
      }
      if (root.hasError) {
        const { issues, truncated } = collectSyntaxIssues(root, decoded.content);
        lines.push(
          `note: file has syntax errors (${issues.length}${truncated ? "+" : ""}); ` +
            `outline may be incomplete — run check_syntax.`,
        );
      }
      return lines.join("\n");
    } finally {
      outcome.tree.delete();
    }
  },
};
