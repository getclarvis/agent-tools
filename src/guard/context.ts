import type { ServerConfig } from "../config.js";
import { analyzeBash } from "./analyze-bash.js";
import { resolveCandidate, patchPaths } from "./paths.js";
import type { BashFacts, GuardContext, PathFact } from "./types.js";

const COMMAND_TOOLS = new Set(["bash", "monitor_start"]);
const PATH_ARG_TOOLS = new Set([
  "read_file",
  "write_file",
  "edit_file",
  "multi_edit",
  "read_image",
  "list_dir",
  "glob",
  "grep",
  "file_stat",
  "tree",
  "outline",
  "check_syntax",
  "mkdir",
  "remove",
]);
const SRC_DEST_TOOLS = new Set(["move", "copy"]);

export function buildGuardContext(
  tool: string,
  args: Record<string, unknown>,
  config: ServerConfig,
): GuardContext {
  const paths: PathFact[] = [];
  let bash: BashFacts | undefined;
  const root = config.workspaceRoot;

  if (COMMAND_TOOLS.has(tool)) {
    if (typeof args.command === "string") {
      bash = analyzeBash(args.command);
      for (const p of bash.paths) paths.push(resolveCandidate(p, root, { shell: true }));
    }
    if (typeof args.cwd === "string") paths.push(resolveCandidate(args.cwd, root));
  } else if (tool === "apply_patch") {
    if (typeof args.patch === "string") {
      for (const p of patchPaths(args.patch)) paths.push(resolveCandidate(p, root));
    }
  } else if (SRC_DEST_TOOLS.has(tool)) {
    if (typeof args.source === "string") paths.push(resolveCandidate(args.source, root));
    if (typeof args.destination === "string") paths.push(resolveCandidate(args.destination, root));
  } else if (tool === "read_files") {
    if (Array.isArray(args.paths)) {
      for (const p of args.paths) {
        if (typeof p === "string") paths.push(resolveCandidate(p, root));
      }
    }
  } else if (tool === "diff") {
    if (typeof args.from === "string") paths.push(resolveCandidate(args.from, root));
    if (typeof args.to === "string") paths.push(resolveCandidate(args.to, root));
  } else if (tool === "replace") {
    const scope = typeof args.path === "string" && args.path.length > 0 ? args.path : ".";
    paths.push(resolveCandidate(scope, root));
  } else if (PATH_ARG_TOOLS.has(tool)) {
    if (typeof args.path === "string") paths.push(resolveCandidate(args.path, root));
  }

  return { tool, args, config, paths, bash };
}
