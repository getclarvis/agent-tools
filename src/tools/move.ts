import { promises as fs } from "node:fs";
import path from "node:path";
import { ToolError, fsError } from "../errors.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import { withFileLocks, assertNotSymlink, fsyncDir } from "../lib/atomic.js";
import type { ToolDef } from "./types.js";

export const move: ToolDef = {
  name: "move",
  description:
    "Move or rename ONE file (atomic). Operates on regular files only — a directory source is " +
    "rejected; use bash for directory moves. Refuses if `destination` already exists unless " +
    "`overwrite` is true. Missing parent directories of the destination are created. To copy " +
    "without removing the source use copy; to change a file's contents use edit_file.",
  inputSchema: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description: "File to move. Relative to workspace root or absolute (~ is not expanded).",
      },
      destination: {
        type: "string",
        description:
          "New path. Relative to workspace root or absolute. Missing parent dirs are created.",
      },
      overwrite: {
        type: "boolean",
        default: false,
        description: "When true, replace an existing destination file. Default: false (refuse).",
      },
    },
    required: ["source", "destination"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const srcRel = args.source as string;
    const dstRel = args.destination as string;
    const overwrite = args.overwrite as boolean;
    const absSrc = resolvePath(srcRel, config.workspaceRoot, config.confineToWorkspace);
    const absDst = resolvePath(dstRel, config.workspaceRoot, config.confineToWorkspace);

    if (absSrc === absDst) {
      throw new ToolError("invalid_input", `Source and destination are the same: ${srcRel}`, {
        path: srcRel,
      });
    }

    return withFileLocks([absSrc, absDst], async () => {
      await assertNotSymlink(absSrc);
      await assertNotSymlink(absDst);

      let srcStat;
      try {
        srcStat = await fs.stat(absSrc);
      } catch (err) {
        throw fsError(err as NodeJS.ErrnoException, srcRel);
      }
      if (srcStat.isDirectory()) {
        throw new ToolError("not_a_file", `Source is a directory (files only): ${srcRel}`, {
          path: srcRel,
        });
      }

      let dstExists = false;
      try {
        const dstStat = await fs.stat(absDst);
        dstExists = true;
        if (dstStat.isDirectory()) {
          throw new ToolError("not_a_file", `Destination is a directory: ${dstRel}`, {
            path: dstRel,
          });
        }
      } catch (err) {
        if (err instanceof ToolError) throw err;
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "ENOENT") throw fsError(e, dstRel);
      }
      if (dstExists && !overwrite) {
        throw new ToolError(
          "invalid_input",
          `Destination already exists: ${dstRel} (pass overwrite: true to replace it)`,
          { path: dstRel },
        );
      }

      try {
        await fs.mkdir(path.dirname(absDst), { recursive: true });
        await fs.rename(absSrc, absDst);
      } catch (err) {
        throw fsError(err as NodeJS.ErrnoException, dstRel);
      }
      await fsyncDir(path.dirname(absSrc));
      await fsyncDir(path.dirname(absDst));

      const from = displayPath(absSrc, config.workspaceRoot);
      const to = displayPath(absDst, config.workspaceRoot);
      return `Moved ${from} → ${to}${dstExists ? " (overwritten)" : ""}.`;
    });
  },
};
