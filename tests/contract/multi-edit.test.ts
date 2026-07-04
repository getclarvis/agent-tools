import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { multiEdit } from "../../src/tools/multi-edit.js";
import { makeWorkspace, cleanup, makeConfig, callTool, write, read } from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("multi_edit", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("applies edits sequentially (each on the previous result)", async () => {
    write(root, "f.txt", "foo");
    const r = await callTool(
      "multi_edit",
      {
        path: "f.txt",
        edits: [
          { old_string: "foo", new_string: "bar" },
          { old_string: "bar", new_string: "baz" },
        ],
      },
      config,
    );
    expect(r.text).toBe("Applied 2 edits to f.txt.");
    expect(read(root, "f.txt")).toBe("baz");
  });

  it("is all-or-nothing: a failing edit reverts everything and reports its index", async () => {
    write(root, "f.txt", "hello world");
    const r = await callTool(
      "multi_edit",
      {
        path: "f.txt",
        edits: [
          { old_string: "hello", new_string: "hi" },
          { old_string: "zzz", new_string: "x" },
        ],
      },
      config,
    );
    expect(r.json.error).toBe("no_match");
    expect(r.json.index).toBe(1);
    expect(read(root, "f.txt")).toBe("hello world");
  });

  it("rejects an empty edits array with invalid_input", async () => {
    write(root, "f.txt", "x");
    const r = await callTool("multi_edit", { path: "f.txt", edits: [] }, config);
    expect(r.json.error).toBe("invalid_input");
  });

  it("rejects out-of-schema input with invalid_input", async () => {
    write(root, "f.txt", "x");
    const r = await callTool(
      "multi_edit",
      { path: "f.txt", edits: [{ old_string: "x", new_string: "y" }], bogus: 1 },
      config,
    );
    expect(r.json.error).toBe("invalid_input");
  });

  it("flows a whitespace-tolerant edit through and discloses it", async () => {
    write(root, "f.txt", "  a\n  b\n");
    const r = await callTool(
      "multi_edit",
      { path: "f.txt", edits: [{ old_string: "a\nb", new_string: "X" }] },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toContain("whitespace-tolerant");
    expect(read(root, "f.txt")).toBe("X\n");
  });

  it("reports the failing index when a tolerant edit is ambiguous", async () => {
    const original = "  a\n    b\nx\n  a\n    b\n";
    write(root, "f.txt", original);
    const r = await callTool(
      "multi_edit",
      {
        path: "f.txt",
        edits: [
          { old_string: "x", new_string: "Y" },
          { old_string: "a\nb", new_string: "Q" },
        ],
      },
      config,
    );
    expect(r.json.error).toBe("ambiguous_match");
    expect(r.json.index).toBe(1);
    expect(read(root, "f.txt")).toBe(original);
  });
});

describe("multi_edit edge cases", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("surfaces a TypeError when an edit entry is malformed", async () => {
    write(root, "f.txt", "hello world");
    await expect(multiEdit.handler({ path: "f.txt", edits: [null] }, config)).rejects.toThrow(
      TypeError,
    );
  });

  it("skips an undefined edit slot yet still counts it as applied", async () => {
    write(root, "f.txt", "hello world");
    const msg = await multiEdit.handler({ path: "f.txt", edits: [undefined] }, config);
    expect(msg).toContain("Applied 1 edit to");
    expect(read(root, "f.txt")).toBe("hello world");
  });

  it("continues past an undefined slot and still applies a later real edit", async () => {
    write(root, "f.txt", "alpha beta");
    const msg = await multiEdit.handler(
      { path: "f.txt", edits: [undefined, { old_string: "beta", new_string: "gamma" }] },
      config,
    );
    expect(msg).toContain("Applied 2 edits to");
    expect(read(root, "f.txt")).toBe("alpha gamma");
  });
});

describe("multi_edit syntax annotation", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { treeSitterAvailable: true });
  });
  afterEach(() => cleanup(root));

  it("warns when the combined edits break the parse", async () => {
    write(root, "a.py", "def f():\n    return 1\n");
    const r = await callTool(
      "multi_edit",
      { path: "a.py", edits: [{ old_string: "def f():", new_string: "def f(:" }] },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Applied 1 edit to");
    expect(r.text).toContain("warning: python syntax error in a.py at line 1");
  });

  it("stays silent when the result parses", async () => {
    write(root, "a.py", "def f():\n    return 1\n");
    const r = await callTool(
      "multi_edit",
      { path: "a.py", edits: [{ old_string: "return 1", new_string: "return 2" }] },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).not.toContain("warning:");
  });
});
