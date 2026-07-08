import { createTwoFilesPatch } from "diff";

export function unifiedDiff(rel: string, before: string, after: string): string | undefined {
  if (before === after) return undefined;
  return createTwoFilesPatch(rel, rel, before, after, undefined, undefined, { context: 3 });
}
