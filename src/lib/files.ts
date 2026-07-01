import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { glob as tinyglob } from "tinyglobby";
import { ToolError, fsError } from "../errors.js";
import { loadIgnore } from "./ignore.js";

export const STAT_CONCURRENCY = 32;

export async function statDirectory(absPath: string, relForError: string): Promise<Stats> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (err) {
    throw fsError(err as NodeJS.ErrnoException, relForError);
  }
  if (!stat.isDirectory()) {
    throw new ToolError("not_a_file", `Not a directory: ${relForError}`, { path: relForError });
  }
  return stat;
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function listFiles(
  base: string,
  workspaceRoot: string,
  opts: { pattern: string; respectGitignore: boolean },
): Promise<string[]> {
  const rels = await tinyglob(opts.pattern, {
    cwd: base,
    dot: true,
    onlyFiles: true,
    absolute: false,
  });
  const ig = opts.respectGitignore ? loadIgnore(workspaceRoot) : null;
  const kept: string[] = [];
  for (const rel of rels) {
    const abs = path.resolve(base, rel);
    if (ig && ig.ignores(path.relative(workspaceRoot, abs))) continue;
    kept.push(abs);
  }
  return kept;
}
