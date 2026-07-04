import type { BashFacts, GuardContext } from "./types.js";

export function withinWorkspace(ctx: GuardContext): boolean {
  if (ctx.bash?.undecidable) return false;
  if (ctx.paths.length === 0) return false;
  return ctx.paths.every((p) => p.withinWorkspace);
}

export function touchesOutside(ctx: GuardContext): boolean {
  return ctx.paths.some((p) => !p.withinWorkspace);
}

export function commandsIn(bash: BashFacts, allowed: string[]): boolean {
  if (bash.undecidable) return false;
  if (bash.segments.length === 0) return false;
  return bash.segments.every((s) =>
    allowed.some((entry) => {
      const e = entry.trim();
      if (e === "") return false;
      return s.normalized === e || s.normalized.startsWith(e + " ");
    }),
  );
}
