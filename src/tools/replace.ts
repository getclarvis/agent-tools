import { promises as fs } from "node:fs";
import { createTwoFilesPatch } from "diff";
import { ToolError, fsError } from "../errors.js";
import { applyOpsAtomic, withFileLocks, type FileOp } from "../lib/atomic.js";
import { listFiles } from "../lib/files.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import { syntaxWarnings } from "../lib/syntax-annotate.js";
import { reencode } from "../lib/text.js";
import { readTextBuffer } from "../lib/textfile.js";
import type { ServerConfig } from "../config.js";
import type { ToolDef } from "./types.js";

interface Changed {
  rel: string;
  count: number;
  before: string;
  after: string;
  text: string;
}

function buildRegex(pattern: string, ignoreCase: boolean, multiline: boolean): RegExp {
  let flags = "g";
  if (multiline) flags += "ms";
  if (ignoreCase) flags += "i";
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    throw new ToolError("invalid_input", `Invalid regex: ${(err as Error).message}`, { pattern });
  }
}

async function scopeFiles(
  pathArg: string | undefined,
  glob: string | undefined,
  config: ServerConfig,
): Promise<string[]> {
  const root = resolvePath(pathArg ?? ".", config.workspaceRoot, config.confineToWorkspace);
  let stat;
  try {
    stat = await fs.stat(root);
  } catch (err) {
    throw fsError(err as NodeJS.ErrnoException, pathArg ?? ".");
  }
  if (stat.isFile()) return [root];
  if (!stat.isDirectory()) return [];
  const pattern = glob ? (glob.includes("/") ? glob : `**/${glob}`) : "**/*";
  const files = await listFiles(root, config.workspaceRoot, { pattern, respectGitignore: true });
  files.sort();
  return files;
}

export const replace: ToolDef = {
  name: "replace",
  description:
    "Find-and-replace across the workspace with a preview-first, atomic apply. `pattern` is a regular " +
    "expression (like grep); `replacement` may reference capture groups with `$1`..`$9` and the whole " +
    "match with `$&` — use `$$` for a literal `$`. Scope with `path` (a file or directory) and/or " +
    "`glob`; at least one is required. Ignored files (.gitignore) are skipped, as are binary and " +
    "oversized files. `dry_run` defaults to true: it reports the match counts and a unified-diff " +
    "preview WITHOUT writing. Re-run with `dry_run: false` to apply all edits atomically (all files " +
    "succeed or none do), preserving each file's line endings.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          "Regular expression to match (JavaScript regex syntax). Escape metacharacters.",
      },
      replacement: {
        type: "string",
        description:
          "Replacement text. `$1`..`$9` insert capture groups, `$&` the whole match; `$$` is a literal `$`.",
      },
      path: {
        type: "string",
        description:
          "File or directory to scope the replacement to. Relative to workspace root or absolute " +
          "(~ is not expanded). A directory is walked honoring ignore rules.",
      },
      glob: {
        type: "string",
        description:
          "Glob filtering which files under the scope are edited (e.g. `**/*.ts`). A bare pattern " +
          "without `/` matches in any directory. Required if `path` is omitted or a directory.",
      },
      ignore_case: { type: "boolean", description: "Case-insensitive matching (regex `i` flag)." },
      multiline: {
        type: "boolean",
        description:
          "Treat the file as one string so a pattern can span lines and `.` matches newlines " +
          "(regex `m`+`s` flags).",
      },
      dry_run: {
        type: "boolean",
        default: true,
        description:
          "When true (the default), only preview: report counts and a diff without writing. Set " +
          "false to apply the edits.",
      },
    },
    required: ["pattern", "replacement"],
  },
  async handler(args, config) {
    const pattern = args.pattern as string;
    const replacement = args.replacement as string;
    const pathArg = typeof args.path === "string" && args.path.length > 0 ? args.path : undefined;
    const glob = typeof args.glob === "string" && args.glob.length > 0 ? args.glob : undefined;
    const dryRun = args.dry_run !== false;

    if (pathArg === undefined && glob === undefined) {
      throw new ToolError("invalid_input", "Provide `path` or `glob` to scope the replacement.");
    }

    const re = buildRegex(pattern, args.ignore_case === true, args.multiline === true);
    if (new RegExp(pattern).test("")) {
      throw new ToolError(
        "invalid_input",
        "pattern matches the empty string; refusing to insert the replacement between every character.",
        { pattern },
      );
    }

    const files = await scopeFiles(pathArg, glob, config);

    const ops: FileOp[] = [];
    const changed: Changed[] = [];
    let totalReplacements = 0;
    let scanned = 0;

    for (const file of files) {
      const decoded = await readTextBuffer(file, config.maxFileBytes);
      if (!decoded) continue;
      scanned++;
      const matches = decoded.content.match(re);
      if (!matches) continue;
      const after = decoded.content.replace(re, replacement);
      if (after === decoded.content) continue;
      const rel = displayPath(file, config.workspaceRoot);
      const text = reencode(after, decoded);
      ops.push({ type: "modify", path: file, content: text });
      changed.push({ rel, count: matches.length, before: decoded.content, after, text });
      totalReplacements += matches.length;
    }

    if (changed.length === 0) return "(no matches)";

    if (dryRun) {
      const head = `${totalReplacements} replacement(s) across ${changed.length} file(s); ${scanned} scanned (dry run — pass dry_run: false to apply)`;
      const diffs = changed.map((c) =>
        createTwoFilesPatch(c.rel, c.rel, c.before, c.after, undefined, undefined, { context: 3 }),
      );
      return [head, "", ...diffs].join("\n");
    }

    try {
      await withFileLocks(
        ops.map((o) => o.path),
        () => applyOpsAtomic(ops),
      );
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw new ToolError("io_error", `Failed to apply replacement: ${(err as Error).message}`);
    }

    const summary = changed.map(
      (c) => `  M ${c.rel} (${c.count} replacement${c.count === 1 ? "" : "s"})`,
    );
    const written = changed.map((c) => ({ rel: c.rel, text: c.text }));
    const content =
      `Replaced ${totalReplacements} occurrence(s) in ${changed.length} file(s):\n` +
      summary.join("\n") +
      (await syntaxWarnings(written, config));
    const diff = changed
      .map((c) =>
        createTwoFilesPatch(c.rel, c.rel, c.before, c.after, undefined, undefined, { context: 3 }),
      )
      .join("\n");
    return diff ? { content, meta: { diff } } : { content };
  },
};
