import { promises as fs } from "node:fs";
import path from "node:path";
import { fsError } from "../errors.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import { mapLimit, statDirectory, STAT_CONCURRENCY } from "../lib/files.js";
import { loadIgnore, type Matcher } from "../lib/ignore.js";
import type { ServerConfig } from "../config.js";
import type { ToolDef } from "./types.js";

interface Entry {
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
}

async function readEntries(
  dir: string,
  config: ServerConfig,
  ig: Matcher | null,
): Promise<Entry[]> {
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw fsError(err as NodeJS.ErrnoException, displayPath(dir, config.workspaceRoot));
  }

  const mapped = await mapLimit(dirents, STAT_CONCURRENCY, async (d) => {
    const abs = path.join(dir, d.name);
    if (ig && ig.ignores(path.relative(config.workspaceRoot, abs))) return null;
    const isSymlink = d.isSymbolicLink();
    if (isSymlink) return { name: d.name, isDir: false, isSymlink: true, size: 0 };
    if (d.isDirectory()) return { name: d.name, isDir: true, isSymlink: false, size: 0 };
    let size: number;
    try {
      size = (await fs.stat(abs)).size;
    } catch {
      size = 0;
    }
    return { name: d.name, isDir: false, isSymlink: false, size };
  });

  const entries = mapped.filter((e): e is Entry => e !== null);
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return entries;
}

function renderLabel(e: Entry): string {
  if (e.isDir) return `${e.name}/`;
  if (e.isSymlink) return `${e.name}@`;
  return `${e.name}\t${e.size}`;
}

const DEFAULT_TREE_DEPTH = 4;
const MAX_TREE_DEPTH = 20;

async function walk(
  dir: string,
  prefix: string,
  depth: number,
  maxDepth: number | undefined,
  config: ServerConfig,
  ig: Matcher | null,
  out: string[],
): Promise<void> {
  const entries = await readEntries(dir, config, ig);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const last = i === entries.length - 1;
    out.push(prefix + (last ? "└── " : "├── ") + renderLabel(e));
    if (e.isDir && (maxDepth === undefined || depth < maxDepth)) {
      await walk(
        path.join(dir, e.name),
        prefix + (last ? "    " : "│   "),
        depth + 1,
        maxDepth,
        config,
        ig,
        out,
      );
    }
  }
}

export const tree: ToolDef = {
  name: "tree",
  description:
    "Print a directory as an indented tree (directories end with `/`, symlinks with `@`, files " +
    "show a byte size). Recurses up to `depth` levels (default 4) unless a larger `depth` is given; " +
    "by default skips paths ignored by .gitignore and the .git/ directory. Symlinked directories are " +
    "listed but not traversed. Output is byte-bounded. Use list_dir for one level, glob to match files by pattern.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Root directory of the tree. Relative to workspace root or absolute. Default: " +
          "workspace root.",
      },
      depth: {
        type: "integer",
        minimum: 0,
        description: "Maximum levels to descend below the root. 0 or omit for the default (4).",
      },
      respect_gitignore: {
        type: "boolean",
        default: true,
        description:
          "When true (default), skip files ignored by .gitignore and the .git/ directory.",
      },
    },
    required: [],
  },
  async handler(args, config) {
    const rel = (args.path as string | undefined) ?? ".";
    const target = resolvePath(rel, config.workspaceRoot, config.confineToWorkspace);
    const requestedDepth = (args.depth as number | undefined) || DEFAULT_TREE_DEPTH;
    const maxDepth = Math.min(requestedDepth, MAX_TREE_DEPTH);
    const respectGitignore = args.respect_gitignore as boolean;

    await statDirectory(target, rel);

    const ig = respectGitignore ? loadIgnore(config.workspaceRoot) : null;
    const out: string[] = [displayPath(target, config.workspaceRoot)];
    await walk(target, "", 1, maxDepth, config, ig, out);
    if (out.length === 1) out.push("(no entries)");
    return out.join("\n");
  },
};
