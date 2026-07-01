import path from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { ToolError } from "../errors.js";

export function resolvePath(input: string, workspaceRoot: string, confine = false): string {
  const abs = path.isAbsolute(input) ? path.normalize(input) : path.resolve(workspaceRoot, input);
  if (confine) assertWithinWorkspace(abs, workspaceRoot, input);
  return abs;
}

export function displayPath(absPath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, absPath);
  if (rel === "") return ".";
  if (rel.startsWith("..") || path.isAbsolute(rel)) return absPath;
  return rel;
}

function assertWithinWorkspace(abs: string, workspaceRoot: string, input: string): void {
  const rootReal = canonicalize(workspaceRoot);
  const targetReal = canonicalizeAllowingMissing(abs);
  if (targetReal !== rootReal && !targetReal.startsWith(rootReal + path.sep)) {
    throw new ToolError(
      "path_escape",
      `Path escapes the workspace root: ${input} (set ALLOW_OUTSIDE_WORKSPACE=1 to permit)`,
      { path: input },
    );
  }
}

function canonicalize(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return path.normalize(p);
  }
}

function canonicalizeAllowingMissing(abs: string): string {
  const tail: string[] = [];
  let cur = abs;
  while (!existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) return path.normalize(abs);
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  const real = canonicalize(cur);
  return tail.length > 0 ? path.join(real, ...tail) : real;
}
