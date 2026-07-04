import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  write,
  writeBinary,
  writeUtf16,
} from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("check_syntax", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { treeSitterAvailable: true });
  });
  afterEach(() => cleanup(root));

  it("reports ok for a valid TypeScript file", async () => {
    write(root, "a.ts", "export const x: number = 1;\n");
    const r = await callTool("check_syntax", { path: "a.ts" }, config);
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({
      path: "a.ts",
      language: "typescript",
      ok: true,
      errors: [],
      error_count: 0,
      truncated: false,
    });
  });

  it("reports errors with 1-based line/column, kind, and excerpt", async () => {
    write(root, "b.ts", "const ok = 1;\nconst x = = 1;\n");
    const r = await callTool("check_syntax", { path: "b.ts" }, config);
    expect(r.isError).toBe(false);
    expect(r.json.ok).toBe(false);
    expect(r.json.error_count).toBeGreaterThan(0);
    const errors = r.json.errors as Array<Record<string, unknown>>;
    expect(errors[0]).toMatchObject({ kind: "error", line: 2 });
    expect(errors[0]?.near).toContain("const x = = 1;");
  });

  it("reports a missing token in Python", async () => {
    write(root, "c.py", "def f(:\n  pass\n");
    const r = await callTool("check_syntax", { path: "c.py" }, config);
    expect(r.json.ok).toBe(false);
    const errors = r.json.errors as Array<Record<string, unknown>>;
    expect(errors.some((e) => e.kind === "missing")).toBe(true);
  });

  it("covers grammars outside the outline set, keyed by extension", async () => {
    write(root, "ok.rb", "class Foo\n  def bar\n  end\nend\n");
    write(root, "bad.rb", "class Foo\n  def bar\n");
    write(root, "ok.sh", "echo hi\n");
    write(root, "ok.css", "a { color: red; }\n");

    expect((await callTool("check_syntax", { path: "ok.rb" }, config)).json.ok).toBe(true);
    expect((await callTool("check_syntax", { path: "bad.rb" }, config)).json.ok).toBe(false);
    expect((await callTool("check_syntax", { path: "ok.sh" }, config)).json).toMatchObject({
      language: "bash",
      ok: true,
    });
    expect((await callTool("check_syntax", { path: "ok.css" }, config)).json).toMatchObject({
      language: "css",
      ok: true,
    });
  });

  it("rejects an unsupported extension with invalid_input listing supported ones", async () => {
    write(root, "notes.txt", "hello\n");
    const r = await callTool("check_syntax", { path: "notes.txt" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("invalid_input");
    expect(r.json.message).toContain("'.txt'");
    expect(r.json.message).toContain(".ts");
  });

  it("rejects an extensionless path with invalid_input", async () => {
    write(root, "Makefile", "all:\n");
    const r = await callTool("check_syntax", { path: "Makefile" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("invalid_input");
    expect(r.json.message).toContain("extensionless");
  });

  it("returns not_found for a missing file", async () => {
    const r = await callTool("check_syntax", { path: "nope.ts" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("not_found");
  });

  it("rejects a binary file", async () => {
    writeBinary(root, "bin.ts");
    const r = await callTool("check_syntax", { path: "bin.ts" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("is_binary");
  });

  it("parses a UTF-16 file after decoding", async () => {
    writeUtf16(root, "u16.ts", "const x = 1;\n");
    const r = await callTool("check_syntax", { path: "u16.ts" }, config);
    expect(r.isError).toBe(false);
    expect(r.json.ok).toBe(true);
  });

  it("rejects a file over the parse limit with too_large", async () => {
    write(root, "big.py", `x = "${"a".repeat(2_000_001)}"\n`);
    const r = await callTool("check_syntax", { path: "big.py" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("too_large");
  });

  it("maps an aborted signal to the aborted error code", async () => {
    write(root, "a.ts", "const x = 1;\n");
    const ac = new AbortController();
    ac.abort();
    const r = await callTool("check_syntax", { path: "a.ts" }, config, ac.signal);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("aborted");
  });

  it("rejects a path escaping the workspace", async () => {
    const r = await callTool("check_syntax", { path: "../outside.ts" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("path_escape");
  });

  it("is available on the read-only surface", async () => {
    write(root, "a.ts", "const x = 1;\n");
    const ro = makeConfig(root, { readOnly: true, treeSitterAvailable: true });
    const r = await callTool("check_syntax", { path: "a.ts" }, ro);
    expect(r.isError).toBe(false);
    expect(r.json.ok).toBe(true);
  });

  it("maps a broken runtime to an internal error", async () => {
    const { _resetTreeSitterForTests } = await import("../../src/lib/treesitter.js");
    const { setWarnSink } = await import("../../src/lib/log.js");
    setWarnSink(() => {});
    _resetTreeSitterForTests(() => {
      throw new Error("boom");
    });
    try {
      write(root, "a.ts", "const x = 1;\n");
      const r = await callTool("check_syntax", { path: "a.ts" }, config);
      expect(r.isError).toBe(true);
      expect(r.json.error).toBe("internal");
    } finally {
      _resetTreeSitterForTests();
      setWarnSink(null);
    }
  });
});
