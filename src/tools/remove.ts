import { promises as fs } from "node:fs";
import { ToolError, fsError } from "../errors.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import { withFileLock, applyOpsAtomic } from "../lib/atomic.js";
import type { ToolDef } from "./types.js";

export const remove: ToolDef = {
  name: "remove",
  description:
    "Delete ONE file. Operates on regular files only — a directory is rejected; use bash for " +
    "recursive directory removal. Fails with not_found if the path does not exist. Refuses to " +
    "delete through a symlink.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File to delete. Relative to workspace root or absolute (~ is not expanded).",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const rel = args.path as string;
    const target = resolvePath(rel, config.workspaceRoot, config.confineToWorkspace);

    return withFileLock(target, async () => {
      let stat;
      try {
        stat = await fs.lstat(target);
      } catch (err) {
        throw fsError(err as NodeJS.ErrnoException, rel);
      }
      if (stat.isDirectory()) {
        throw new ToolError("not_a_file", `Path is a directory (files only): ${rel}`, {
          path: rel,
        });
      }

      try {
        await applyOpsAtomic([{ type: "delete", path: target }]);
      } catch (err) {
        if (err instanceof ToolError) throw err;
        throw fsError(err as NodeJS.ErrnoException, rel);
      }
      return `Removed ${displayPath(target, config.workspaceRoot)}.`;
    });
  },
};
