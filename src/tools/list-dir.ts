import { promises as fs } from "node:fs";
import path from "node:path";
import { fsError } from "../errors.js";
import { resolvePath } from "../lib/paths.js";
import { mapLimit, statDirectory, STAT_CONCURRENCY } from "../lib/files.js";
import type { ToolDef } from "./types.js";

export const listDir: ToolDef = {
  name: "list_dir",
  description:
    "List the immediate entries of one directory (non-recursive). Directories first, then files; " +
    "directories end with `/` and files show a byte size. Includes dotfiles; does NOT apply " +
    ".gitignore. To match files by pattern across subdirectories use glob; to search file contents " +
    "use grep.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Directory to list. Relative to workspace root or absolute. Default: workspace root.",
      },
    },
    required: [],
  },
  async handler(args, config) {
    const rel = (args.path as string | undefined) ?? ".";
    const target = resolvePath(rel, config.workspaceRoot, config.confineToWorkspace);

    await statDirectory(target, rel);

    let entries;
    try {
      entries = await fs.readdir(target, { withFileTypes: true });
    } catch (err) {
      throw fsError(err as NodeJS.ErrnoException, rel);
    }

    const items = await mapLimit(entries, STAT_CONCURRENCY, async (e) => {
      let isDir = e.isDirectory();
      let size = 0;
      if (!isDir || e.isSymbolicLink()) {
        try {
          const st = await fs.stat(path.join(target, e.name));
          isDir = st.isDirectory();
          size = st.size;
        } catch {
          isDir = false;
        }
      }
      return { name: e.name, isDir, size };
    });

    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

    if (items.length === 0) return "(empty directory)";
    return items.map((it) => (it.isDir ? `${it.name}/` : `${it.name}\t${it.size}`)).join("\n");
  },
};
