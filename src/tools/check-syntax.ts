import path from "node:path";
import { ToolError } from "../errors.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import { readTextFile } from "../lib/textfile.js";
import {
  MAX_PARSE_BYTES,
  checkSyntaxText,
  grammarForPath,
  supportedExtensions,
} from "../lib/treesitter.js";
import type { ToolDef } from "./types.js";

export const checkSyntax: ToolDef = {
  name: "check_syntax",
  description:
    "Parse ONE source file and report syntax errors as JSON, each with a 1-based line/column, a " +
    "kind (error or missing) and a nearby excerpt. The language is picked by file extension. " +
    "This is a pure parse check — it does NOT type-check, resolve imports, or lint; a clean " +
    "result means the file parses, not that it compiles. Use after editing a file to confirm it " +
    "still parses.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Source file to check. Relative to workspace root or absolute (~ is not expanded).",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async handler(args, config, signal) {
    const rel = args.path as string;
    const target = resolvePath(rel, config.workspaceRoot, config.confineToWorkspace);

    const grammar = grammarForPath(target);
    if (!grammar) {
      const ext = path.extname(target).toLowerCase();
      throw new ToolError(
        "invalid_input",
        `check_syntax does not support ${ext ? `'${ext}'` : "extensionless"} files; ` +
          `supported extensions: ${supportedExtensions().join(", ")}`,
        { path: rel },
      );
    }

    const decoded = await readTextFile(target, rel, config.maxFileBytes);
    if (Buffer.byteLength(decoded.content, "utf8") > MAX_PARSE_BYTES) {
      throw new ToolError(
        "too_large",
        `File exceeds the ${MAX_PARSE_BYTES}-byte parse limit: ${rel}`,
        { path: rel, limit: MAX_PARSE_BYTES },
      );
    }

    const outcome = await checkSyntaxText(decoded.content, grammar, { signal });
    if (outcome === "timeout") {
      throw new ToolError("timeout", `Parsing timed out: ${rel}`, { path: rel });
    }
    if (outcome === "aborted") {
      throw new ToolError("aborted", `Parsing aborted: ${rel}`, { path: rel });
    }
    if (outcome === "unavailable") {
      throw new ToolError("internal", "tree-sitter runtime failed to load");
    }

    return JSON.stringify({
      path: displayPath(target, config.workspaceRoot),
      language: grammar,
      ok: outcome.ok,
      errors: outcome.errors,
      error_count: outcome.errors.length,
      truncated: outcome.truncated,
    });
  },
};
