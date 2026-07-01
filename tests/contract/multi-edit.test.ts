import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
