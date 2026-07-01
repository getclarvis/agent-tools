import { createRequire } from "node:module";
import type { Ignore } from "ignore";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const makeIgnore = createRequire(import.meta.url)("ignore") as (options?: object) => Ignore;

export interface Matcher {
  ignores(relPath: string): boolean;
}

function readFileSafe(p: string): string | undefined {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

function findIgnoreRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function globalExcludesPath(): string | undefined {
  const xdg = process.env.XDG_CONFIG_HOME;
  const candidate = xdg
    ? path.join(xdg, "git", "ignore")
    : path.join(os.homedir(), ".config", "git", "ignore");
  return existsSync(candidate) ? candidate : undefined;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function loadIgnore(workspaceRoot: string): Matcher {
  const ignoreRoot = findIgnoreRoot(workspaceRoot);

  const base = makeIgnore();
  base.add(".git\n.clarvis\n.clarvis-tmp-*");
  const infoExclude = readFileSafe(path.join(ignoreRoot, ".git", "info", "exclude"));
  if (infoExclude !== undefined) base.add(infoExclude);
  const globalPath = globalExcludesPath();
  if (globalPath) {
    const g = readFileSafe(globalPath);
    if (g !== undefined) base.add(g);
  }

  const perDir = new Map<string, Ignore | null>();
  function dirMatcher(dir: string): Ignore | null {
    const cached = perDir.get(dir);
    if (cached !== undefined) return cached;
    const gitignorePath = path.join(dir, ".gitignore");
    const content = readFileSafe(gitignorePath);
    if (content === undefined && existsSync(gitignorePath)) {
      process.stderr.write(`clarvis-agent-tools: warning: cannot read ${gitignorePath}\n`);
    }
    const m = content !== undefined ? makeIgnore().add(content) : null;
    perDir.set(dir, m);
    return m;
  }

  function dirsFromRootTo(dir: string): string[] {
    const chain: string[] = [];
    let cur = dir;
    for (;;) {
      chain.push(cur);
      if (cur === ignoreRoot) return chain.reverse();
      const parent = path.dirname(cur);
      if (parent === cur) return [];
      cur = parent;
    }
  }

  function apply(m: Ignore, rel: string, current: boolean | undefined): boolean | undefined {
    if (!rel || rel.startsWith("../")) return current;
    const r = m.test(rel);
    if (r.ignored) return true;
    if (r.unignored) return false;
    return current;
  }

  return {
    ignores(relPath: string): boolean {
      if (!relPath || relPath === ".") return false;
      const norm = toPosix(relPath);
      if (norm.startsWith("../") || path.isAbsolute(norm)) return false;

      const abs = path.resolve(workspaceRoot, relPath);
      if (toPosix(path.relative(ignoreRoot, abs)).split("/").includes(".git")) return true;

      let decision: boolean | undefined = apply(
        base,
        toPosix(path.relative(ignoreRoot, abs)),
        undefined,
      );
      for (const dir of dirsFromRootTo(path.dirname(abs))) {
        const m = dirMatcher(dir);
        if (m) decision = apply(m, toPosix(path.relative(dir, abs)), decision);
      }
      return decision === true;
    },
  };
}
