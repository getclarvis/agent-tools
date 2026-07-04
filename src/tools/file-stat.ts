import { promises as fs } from "node:fs";
import { fsError } from "../errors.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import { isBinary } from "../lib/binary.js";
import { sniffImageMime } from "../lib/image.js";
import type { ToolDef } from "./types.js";

const HEAD_BYTES = 8192;

function octalMode(mode: number): string {
  return "0" + (mode & 0o777).toString(8).padStart(3, "0");
}

export const fileStat: ToolDef = {
  name: "file_stat",
  description:
    "Return structured metadata for ONE path as a JSON object: type " +
    "(file/directory/symlink/other), size in bytes, mtime (ISO-8601), mode (octal). A symlink is " +
    "reported without being followed, with its target. For a regular file it also reports whether " +
    "the content looks binary and, for an image, its MIME type — reading only a small head slice, " +
    "so it works on files too large to read. Use before read_file to check size/type.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to inspect. Relative to workspace root or absolute (~ is not expanded).",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const rel = args.path as string;
    const target = resolvePath(rel, config.workspaceRoot, config.confineToWorkspace);

    let lst;
    try {
      lst = await fs.lstat(target);
    } catch (err) {
      throw fsError(err as NodeJS.ErrnoException, rel);
    }

    const disp = displayPath(target, config.workspaceRoot);
    const mtime = lst.mtime.toISOString();
    const mode = octalMode(lst.mode);

    if (lst.isSymbolicLink()) {
      let symlinkTarget: string | null;
      try {
        symlinkTarget = await fs.readlink(target);
      } catch {
        symlinkTarget = null;
      }
      return JSON.stringify({
        path: disp,
        type: "symlink",
        size: lst.size,
        mtime,
        mode,
        symlink_target: symlinkTarget,
      });
    }

    if (lst.isDirectory()) {
      return JSON.stringify({ path: disp, type: "directory", size: lst.size, mtime, mode });
    }

    if (!lst.isFile()) {
      return JSON.stringify({ path: disp, type: "other", size: lst.size, mtime, mode });
    }

    let head: Buffer;
    try {
      const fh = await fs.open(target, "r");
      try {
        const buf = Buffer.alloc(Math.min(HEAD_BYTES, lst.size));
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        head = buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    } catch (err) {
      throw fsError(err as NodeJS.ErrnoException, rel);
    }

    return JSON.stringify({
      path: disp,
      type: "file",
      size: lst.size,
      mtime,
      mode,
      binary: isBinary(head),
      mime: sniffImageMime(head),
    });
  },
};
