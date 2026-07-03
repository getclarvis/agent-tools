import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, cleanup, makeConfig, callTool, write } from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("grep composeResult page-exceeded branch (in-process)", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { ripgrepAvailable: false, maxOutputBytes: 300 });
  });
  afterEach(() => cleanup(root));

  it("warns the page was cut when the full result set overflows the byte cap without truncating the scan", async () => {
    const lines = Array.from({ length: 120 }, () => "x").join("\n") + "\n";
    write(root, "f.txt", lines);

    const r = await callTool("grep", { pattern: "x", output_mode: "content" }, config);

    expect(r.isError).toBe(false);
    expect(r.text).toContain("[... page exceeded 300 bytes and was cut");
    expect(r.text).toContain("set or reduce head_limit to page in smaller chunks");
    expect(r.text).not.toContain("[... search incomplete");
    expect(r.text).not.toContain("call again with offset");
  });

  it("still warns 'page exceeded' when head_limit is set but the page itself is too big", async () => {
    const lines = Array.from({ length: 120 }, () => "y").join("\n") + "\n";
    write(root, "big.txt", lines);

    const r = await callTool(
      "grep",
      { pattern: "y", output_mode: "content", head_limit: 100 },
      config,
    );

    expect(r.isError).toBe(false);
    expect(r.text).toContain("[... page exceeded 300 bytes and was cut");
    expect(r.text).not.toContain("[... search incomplete");
    expect(r.text).not.toContain("call again with offset");
  });

  it("does NOT warn when the page fits: a byte-bounded page under the cap returns cleanly", async () => {
    write(root, "small.txt", "hit\n");

    const r = await callTool("grep", { pattern: "hit", output_mode: "content" }, config);

    expect(r.isError).toBe(false);
    expect(r.text).toBe("small.txt:1:hit");
    expect(r.text).not.toContain("[... page exceeded");
  });
});

describe("grep count-mode + context separator branches (in-process)", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { ripgrepAvailable: false });
  });
  afterEach(() => cleanup(root));

  it("count mode over multiple files runs the entry sort and per-file tally", async () => {
    write(root, "a.txt", "foo\nfoo\n");
    write(root, "b.txt", "foo\n");

    const r = await callTool("grep", { pattern: "foo", output_mode: "count" }, config);

    expect(r.isError).toBe(false);
    expect(r.text).toBe("a.txt:2\nb.txt:1");
    expect(r.text).not.toContain("(no matches)");
  });

  it("count mode paginates entries with head_limit and footers the remainder", async () => {
    write(root, "a.txt", "hit\n");
    write(root, "b.txt", "hit\n");
    write(root, "c.txt", "hit\n");

    const r = await callTool(
      "grep",
      { pattern: "hit", output_mode: "count", head_limit: 2 },
      config,
    );

    expect(r.isError).toBe(false);
    expect(r.text.split("\n").slice(0, 2)).toEqual(["a.txt:1", "b.txt:1"]);
    expect(r.text).toContain("showing 0..2 of 3");
    expect(r.text).toContain("offset=2");
  });

  it("content mode with context inserts a -- separator when the file changes", async () => {
    write(root, "a.txt", "pre\nMATCH\npost\n");
    write(root, "b.txt", "before\nMATCH\nafter\n");

    const r = await callTool(
      "grep",
      { pattern: "MATCH", output_mode: "content", context: 1 },
      config,
    );

    expect(r.isError).toBe(false);
    expect(r.text).toBe(
      [
        "a.txt-1-pre",
        "a.txt:2:MATCH",
        "a.txt-3-post",
        "--",
        "b.txt-1-before",
        "b.txt:2:MATCH",
        "b.txt-3-after",
      ].join("\n"),
    );
    expect(r.text.split("\n").filter((l) => l === "--")).toHaveLength(1);
    expect(r.text.startsWith("--")).toBe(false);
    expect(r.text.endsWith("--")).toBe(false);
  });
});
