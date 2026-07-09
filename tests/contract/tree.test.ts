import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  write,
  chmod,
  isRoot,
} from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("tree", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("renders an indented tree: dirs first with /, files with size", async () => {
    write(root, "src/a.ts", "xx");
    write(root, "b.txt", "y");
    const r = await callTool("tree", {}, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe([".", "├── src/", "│   └── a.ts\t2", "└── b.txt\t1"].join("\n"));
  });

  it("skips .gitignored paths and .git by default, but shows them when disabled", async () => {
    write(root, "keep.txt", "y");
    write(root, ".gitignore", "ignored.txt\n");
    write(root, "ignored.txt", "z");
    const def = await callTool("tree", {}, config);
    expect(def.text).toContain("keep.txt");
    expect(def.text).not.toContain("ignored.txt");

    const all = await callTool("tree", { respect_gitignore: false }, config);
    expect(all.text).toContain("ignored.txt");
  });

  it("limits recursion with depth", async () => {
    write(root, "a/b/c.txt", "x");
    const d1 = await callTool("tree", { depth: 1 }, config);
    expect(d1.text).toContain("a/");
    expect(d1.text).not.toContain("b/");

    const d2 = await callTool("tree", { depth: 2 }, config);
    expect(d2.text).toContain("b/");
    expect(d2.text).not.toContain("c.txt");
  });

  it("lists a symlinked directory with @ but does not traverse it", async () => {
    write(root, "realdir/inner.txt", "x");
    symlinkSync(path.join(root, "realdir"), path.join(root, "linkdir"));
    const r = await callTool("tree", {}, config);
    expect(r.text).toContain("linkdir@");
    // inner.txt appears once (under realdir), not again under linkdir
    expect(r.text.match(/inner\.txt/g)).toHaveLength(1);
  });

  it("returns (no entries) for an empty directory", async () => {
    mkdirSync(path.join(root, "empty"));
    const r = await callTool("tree", { path: "empty" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("empty\n(no entries)");
  });

  it("errors not_found for a missing directory", async () => {
    const r = await callTool("tree", { path: "nope" }, config);
    expect(r.json.error).toBe("not_found");
  });

  it("errors not_a_file when the path is a file", async () => {
    write(root, "f.txt", "x");
    const r = await callTool("tree", { path: "f.txt" }, config);
    expect(r.json.error).toBe("not_a_file");
  });

  it.skipIf(isRoot)("surfaces an unreadable subdirectory as io_error", async () => {
    mkdirSync(path.join(root, "locked"));
    chmod(root, "locked", 0o000);
    try {
      const r = await callTool("tree", {}, config);
      expect(r.isError).toBe(true);
      expect(r.json.error).toBe("io_error");
    } finally {
      chmod(root, "locked", 0o755);
    }
  });

  it("treats depth 0 as unlimited (same as omitting depth)", async () => {
    write(root, "a/b/c.txt", "x");
    const r = await callTool("tree", { depth: 0 }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("a/");
    expect(r.text).toContain("b/");
    expect(r.text).toContain("c.txt");
  });

  it("ignores out-of-schema extra fields", async () => {
    const r = await callTool("tree", { bogus: true }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe(".\n(no entries)");
  });
});
