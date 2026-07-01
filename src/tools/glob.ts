import { promises as fs } from "node:fs";
import { ToolError } from "../errors.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import { listFiles, mapLimit, statDirectory, STAT_CONCURRENCY } from "../lib/files.js";
import type { ToolDef } from "./types.js";

export const globTool: ToolDef = {
  name: "glob",
  description:
    "Find files (not directories) by glob pattern, returned one path per line, " +
    "most-recently-modified first. Use when you know part of a name or extension but not the full " +
    "path. To search file CONTENTS use grep instead. No matches returns the line `(no matches)` — " +
    "a success, not an error.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          'Glob pattern, e.g. "**/*.ts" or "src/**/test_*.py". ** matches across directories.',
      },
      path: {
        type: "string",
        description:
          "Base directory for the search. Relative to workspace root or absolute. Default: " +
          "workspace root.",
      },
      respect_gitignore: {
        type: "boolean",
        default: true,
        description:
          "When true (default), skip files ignored by .gitignore and the .git/ directory.",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const pattern = args.pattern as string;
    const baseRel = (args.path as string | undefined) ?? ".";
    const base = resolvePath(baseRel, config.workspaceRoot, config.confineToWorkspace);
    const respectGitignore = args.respect_gitignore as boolean;

    await statDirectory(base, baseRel);

    let files: string[];
    try {
      files = await listFiles(base, config.workspaceRoot, { pattern, respectGitignore });
    } catch (err) {
      throw new ToolError("invalid_input", `Invalid glob pattern: ${(err as Error).message}`, {
        pattern,
      });
    }

    const stats = await mapLimit(files, STAT_CONCURRENCY, async (abs) => {
      try {
        return { abs, mtime: (await fs.stat(abs)).mtimeMs };
      } catch {
        return null;
      }
    });
    const withMtime = stats
      .filter((s): s is { abs: string; mtime: number } => s !== null)
      .map((s) => ({ rel: displayPath(s.abs, config.workspaceRoot), mtime: s.mtime }));

    if (withMtime.length === 0) return "(no matches)";

    withMtime.sort((a, b) => b.mtime - a.mtime || (a.rel < b.rel ? -1 : 1));
    return withMtime.map((e) => e.rel).join("\n");
  },
};
