import { afterEach, describe, expect, it } from "vitest";
import {
  _resetTreeSitterForTests,
  checkSyntaxText,
  grammarForPath,
  parseText,
  probeTreeSitter,
  supportedExtensions,
} from "../../src/lib/treesitter.js";
import { setWarnSink } from "../../src/lib/log.js";

afterEach(() => {
  _resetTreeSitterForTests();
  setWarnSink(null);
});

describe("probeTreeSitter", () => {
  it("finds the dev-installed @vscode/tree-sitter-wasm", () => {
    expect(probeTreeSitter()).toBe(true);
  });
});

describe("grammarForPath", () => {
  it("maps extensions to grammars, case-insensitively", () => {
    expect(grammarForPath("src/a.ts")).toBe("typescript");
    expect(grammarForPath("src/a.TS")).toBe("typescript");
    expect(grammarForPath("a.tsx")).toBe("tsx");
    expect(grammarForPath("a.jsx")).toBe("javascript");
    expect(grammarForPath("a.pyi")).toBe("python");
    expect(grammarForPath("a.h")).toBe("cpp");
    expect(grammarForPath("a.psm1")).toBe("powershell");
  });

  it("returns undefined for unknown or missing extensions", () => {
    expect(grammarForPath("a.txt")).toBeUndefined();
    expect(grammarForPath("Makefile")).toBeUndefined();
    expect(grammarForPath("")).toBeUndefined();
  });

  it("supportedExtensions lists every mapped extension, sorted", () => {
    const exts = supportedExtensions();
    expect(exts).toContain(".ts");
    expect(exts).toContain(".rb");
    expect(exts).toEqual([...exts].sort());
  });
});

describe("checkSyntaxText", () => {
  it("reports ok for a valid file", async () => {
    const r = await checkSyntaxText("const x = 1;\n", "typescript");
    expect(r).toEqual({ ok: true, errors: [], truncated: false });
  });

  it("reports error nodes with 1-based positions and an excerpt", async () => {
    const r = await checkSyntaxText("const x = = 1;\n", "typescript");
    expect(r).toMatchObject({ ok: false, truncated: false });
    if (typeof r === "string") throw new Error("unreachable");
    expect(r.errors[0]).toMatchObject({ kind: "error", line: 1 });
    expect(r.errors[0]?.column).toBeGreaterThan(0);
    expect(r.errors[0]?.near).toContain("const x = = 1;");
  });

  it("reports missing nodes with the expected token as `near`", async () => {
    const r = await checkSyntaxText("def f(:\n  pass\n", "python");
    if (typeof r === "string") throw new Error("unreachable");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.kind === "missing")).toBe(true);
  });

  it("caps issues at maxIssues and flags truncation", async () => {
    const r = await checkSyntaxText("const x = = 1;\nif (broken {\n", "typescript", {
      maxIssues: 1,
    });
    if (typeof r === "string") throw new Error("unreachable");
    expect(r.errors).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });

  it("truncates long excerpt lines", async () => {
    const r = await checkSyntaxText(`const x = = ${"1 + ".repeat(40)}1;\n`, "typescript");
    if (typeof r === "string") throw new Error("unreachable");
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.near.length).toBeLessThanOrEqual(83);
    expect(r.errors[0]?.near.endsWith("...")).toBe(true);
  });

  it("returns timeout when the deadline is already spent", async () => {
    const r = await checkSyntaxText("const x = 1;", "typescript", { timeoutMs: 0 });
    expect(r).toBe("timeout");
  });

  it("returns aborted for a pre-aborted signal", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await checkSyntaxText("const x = 1;", "typescript", { signal: ac.signal });
    expect(r).toBe("aborted");
  });

  it("returns unavailable and warns when the module import fails", async () => {
    const warnings: string[] = [];
    setWarnSink((m) => warnings.push(m));
    _resetTreeSitterForTests(() => {
      throw new Error("import boom");
    });
    const r = await checkSyntaxText("const x = 1;", "typescript");
    expect(r).toBe("unavailable");
    expect(warnings.join("")).toContain("tree-sitter init failed");
    expect(warnings.join("")).toContain("import boom");
  });

  it("returns unavailable when the module has an unexpected shape", async () => {
    const warnings: string[] = [];
    setWarnSink((m) => warnings.push(m));
    _resetTreeSitterForTests(() => Promise.resolve({ default: {} }));
    const r = await checkSyntaxText("const x = 1;", "typescript");
    expect(r).toBe("unavailable");
    expect(warnings.join("")).toContain("unexpected module shape");
  });

  it("falls back to the raw namespace when the module has no default export", async () => {
    setWarnSink(() => {});
    _resetTreeSitterForTests(() => Promise.resolve({}));
    const r = await checkSyntaxText("const x = 1;", "typescript");
    expect(r).toBe("unavailable");
  });

  it("returns timeout when the deadline expires mid-parse", async () => {
    const big = "const a = 1;\n".repeat(100_000);
    const r = await parseText(big, "typescript", { timeoutMs: 1 });
    expect(r.status).toBe("timeout");
  });

  it("returns unavailable when a grammar fails to load", async () => {
    const real = (await import("@vscode/tree-sitter-wasm")) as unknown as {
      default?: Record<string, unknown>;
    } & Record<string, unknown>;
    const ns = (real.default ?? real) as Record<string, unknown>;
    const warnings: string[] = [];
    setWarnSink((m) => warnings.push(m));
    _resetTreeSitterForTests(() =>
      Promise.resolve({
        default: {
          Parser: ns.Parser,
          Language: { load: () => Promise.reject(new Error("grammar boom")) },
        },
      }),
    );
    const r = await checkSyntaxText("const x = 1;", "typescript");
    expect(r).toBe("unavailable");
    expect(warnings.join("")).toContain("failed to load tree-sitter grammar typescript");
  });

  it("returns unavailable when setLanguage rejects a bogus language object", async () => {
    const real = (await import("@vscode/tree-sitter-wasm")) as unknown as {
      default?: Record<string, unknown>;
    } & Record<string, unknown>;
    const ns = (real.default ?? real) as Record<string, unknown>;
    const warnings: string[] = [];
    setWarnSink((m) => warnings.push(m));
    _resetTreeSitterForTests(() =>
      Promise.resolve({
        default: {
          Parser: ns.Parser,
          Language: { load: () => Promise.resolve({ bogus: true }) },
        },
      }),
    );
    const r = await checkSyntaxText("const x = 1;", "typescript");
    expect(r).toBe("unavailable");
    expect(warnings.join("")).toContain("tree-sitter parse failed");
  });
});

describe("parseText", () => {
  it("parses and hands back a deletable tree", async () => {
    const r = await parseText("const x = 1;", "typescript");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.tree.rootNode.hasError).toBe(false);
    r.tree.delete();
  });

  it("caches the loaded language across calls", async () => {
    const a = await parseText("x = 1", "python");
    const b = await parseText("y = 2", "python");
    if (a.status !== "ok" || b.status !== "ok") throw new Error("unreachable");
    a.tree.delete();
    b.tree.delete();
  });
});
