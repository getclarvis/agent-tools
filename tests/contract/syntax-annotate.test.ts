import { describe, expect, it } from "vitest";
import { syntaxWarning, syntaxWarnings } from "../../src/lib/syntax-annotate.js";

const on = { treeSitterAvailable: true };
const off = { treeSitterAvailable: false };

describe("syntaxWarning", () => {
  it("returns empty when tree-sitter is unavailable", async () => {
    expect(await syntaxWarning("a.ts", "const x = = 1;", off)).toBe("");
  });

  it("returns empty for files without a grammar", async () => {
    expect(await syntaxWarning("a.txt", "const x = = 1;", on)).toBe("");
  });

  it("returns empty for oversized content", async () => {
    const big = `const x = = 1;\n${"a".repeat(1_000_001)}`;
    expect(await syntaxWarning("a.ts", big, on)).toBe("");
  });

  it("swallows internal failures and returns empty", async () => {
    const bogus = 42 as unknown as string;
    expect(await syntaxWarning("a.ts", bogus, on)).toBe("");
  });

  it("describes a missing token distinctly from a stray one", async () => {
    const missing = await syntaxWarning("a.py", "def f(:\n  pass\n", on);
    expect(missing).toContain("missing `");
    const stray = await syntaxWarning("a.ts", "const x = = 1;\n", on);
    expect(stray).toContain("near `");
  });
});

describe("syntaxWarnings", () => {
  it("returns empty when tree-sitter is unavailable", async () => {
    const files = [{ rel: "a.ts", text: "const x = = 1;" }];
    expect(await syntaxWarnings(files, off)).toBe("");
  });

  it("skips ineligible files without spending a check slot", async () => {
    const files = [
      { rel: "notes.txt", text: "const x = = 1;" },
      { rel: "README", text: "const x = = 1;" },
      { rel: "a.ts", text: "const x = = 1;" },
    ];
    const out = await syntaxWarnings(files, on, 1);
    expect(out).toContain("syntax error in a.ts");
  });

  it("stops checking once maxChecks eligible files were parsed", async () => {
    const files = [
      { rel: "ok.ts", text: "const a = 1;" },
      { rel: "bad.ts", text: "const b = = 1;" },
    ];
    const out = await syntaxWarnings(files, on, 1);
    expect(out).toBe("");
  });
});
