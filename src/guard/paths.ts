import { homedir } from "node:os";
import { resolvePath } from "../lib/paths.js";
import type { PathFact } from "./types.js";

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

export function resolveCandidate(
  raw: string,
  workspaceRoot: string,
  opts: { shell?: boolean } = {},
): PathFact {
  const input = opts.shell ? expandTilde(raw) : raw;
  const resolved = resolvePath(input, workspaceRoot);
  let withinWorkspace = true;
  try {
    resolvePath(input, workspaceRoot, true);
  } catch {
    withinWorkspace = false;
  }
  return { raw, resolved, withinWorkspace };
}

function cleanName(raw: string): string | undefined {
  const noTab = raw.split("\t")[0] ?? raw;
  const trimmed = noTab.trim();
  if (trimmed === "") return undefined;
  if (trimmed === "/dev/null") return "/dev/null";
  return trimmed.replace(/^[ab]\//, "");
}

export function patchPaths(patch: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of patch.split("\n")) {
    if (!line.startsWith("--- ") && !line.startsWith("+++ ")) continue;
    const name = cleanName(line.slice(4));
    if (name === undefined || name === "/dev/null" || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
