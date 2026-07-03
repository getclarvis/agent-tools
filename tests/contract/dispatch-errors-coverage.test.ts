import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch, listTools } from "../../src/core.js";
import { fsError, serializeError, ToolError } from "../../src/errors.js";
import { makeWorkspace, cleanup, makeConfig, callTool, write } from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

function errno(code: string | undefined, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code }) as NodeJS.ErrnoException;
}

describe("core.dispatch invalid_input branch", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("missing required arg yields invalid_input (no throw)", async () => {
    const r = await callTool("read_file", {}, config);
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: "invalid_input" });
    expect(typeof r.json.message).toBe("string");
    expect((r.json.message as string).length).toBeGreaterThan(0);
  });

  it("wrong-typed arg yields invalid_input with a detail message", async () => {
    const r = await dispatch("read_file", { path: 123 }, config);
    expect(r.isError).toBe(true);
    const json = JSON.parse(r.text) as Record<string, unknown>;
    expect(json.error).toBe("invalid_input");
    expect(json.message).not.toBe("invalid arguments");
  });

  it("additionalProperties: false rejects unknown args as invalid_input", async () => {
    const r = await dispatch("read_file", { path: "a.txt", bogus: true }, config);
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ error: "invalid_input" });
  });
});

describe("core.dispatch success/catch/listTools paths", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("listTools returns the full surface with schemas", () => {
    const infos = listTools(config);
    expect(infos.length).toBeGreaterThan(0);
    for (const info of infos) {
      expect(typeof info.name).toBe("string");
      expect(typeof info.description).toBe("string");
      expect(info.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("listTools honours the read-only surface", () => {
    const ro = listTools(makeConfig(root, { readOnly: true }));
    const names = ro.map((t) => t.name).sort();
    expect(names).toEqual(["glob", "grep", "list_dir", "read_file"]);
  });

  it("an unknown tool name returns not_found without throwing", async () => {
    const r = await dispatch("no_such_tool", {}, config);
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ error: "not_found" });
  });

  it("a bounded tool returns its handler output verbatim on success", async () => {
    write(root, "hello.txt", "line one\nline two\n");
    const r = await dispatch("read_file", { path: "hello.txt" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("line one");
    expect(r.text).toContain("line two");
  });

  it("an unbounded tool routes its output through the byte-bounder on success", async () => {
    write(root, "a.txt", "x");
    const r = await dispatch("list_dir", {}, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("a.txt");
  });

  it("a handler error thrown at runtime is caught and serialized", async () => {
    const r = await dispatch("read_file", { path: "does-not-exist.txt" }, config);
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ error: "not_found" });
  });
});

describe("errors.fsError code mapping", () => {
  it("maps ENOENT to not_found", () => {
    const e = fsError(errno("ENOENT", "no such"), "/w/a.txt");
    expect(e).toBeInstanceOf(ToolError);
    expect(e.code).toBe("not_found");
    expect(e.fields).toMatchObject({ path: "/w/a.txt" });
    expect(e.message).toContain("/w/a.txt");
  });

  it("maps EISDIR to not_a_file (is a directory)", () => {
    const e = fsError(errno("EISDIR", "illegal operation on a directory"), "/w/dir");
    expect(e.code).toBe("not_a_file");
    expect(e.message).toBe("Path is a directory: /w/dir");
    expect(e.fields).toMatchObject({ path: "/w/dir" });
  });

  it("maps ENOTDIR to not_a_file (not a directory)", () => {
    const e = fsError(errno("ENOTDIR", "not a directory"), "/w/file/child");
    expect(e.code).toBe("not_a_file");
    expect(e.message).toBe("Not a directory: /w/file/child");
    expect(e.fields).toMatchObject({ path: "/w/file/child" });
  });

  it("falls back to io_error for other codes, preserving the code", () => {
    const e = fsError(errno("EACCES", "permission denied"), "/w/locked");
    expect(e.code).toBe("io_error");
    expect(e.message).toBe("EACCES: permission denied");
    expect(e.fields).toMatchObject({ path: "/w/locked" });
  });

  it("falls back to EIO label when the errno has no code", () => {
    const e = fsError(errno(undefined, "boom"), "/w/x");
    expect(e.code).toBe("io_error");
    expect(e.message).toBe("EIO: boom");
  });
});

describe("errors.serializeError shapes", () => {
  it("serializes a ToolError with its code, message and fields", () => {
    const s = serializeError(new ToolError("no_match", "nothing here", { pattern: "x" }));
    expect(JSON.parse(s)).toEqual({ error: "no_match", message: "nothing here", pattern: "x" });
  });

  it("collapses a plain Error (with stack) into a generic internal error", () => {
    const s = serializeError(new Error("kaboom"));
    expect(JSON.parse(s)).toEqual({ error: "internal", message: "internal error" });
  });

  it("collapses an Error whose stack is absent (message fallback)", () => {
    const e = new Error("stackless");
    delete e.stack;
    const s = serializeError(e);
    expect(JSON.parse(s)).toEqual({ error: "internal", message: "internal error" });
  });

  it("collapses a non-Error throwable via String() coercion", () => {
    const s = serializeError("just a string");
    expect(JSON.parse(s)).toEqual({ error: "internal", message: "internal error" });
  });
});
