import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { makeWorkspace, cleanup, makeConfig, callTool, write } from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("list_dir", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("returns (empty directory) for an empty dir (BUG-16)", async () => {
    mkdirSync(path.join(root, "empty"));
    const r = await callTool("list_dir", { path: "empty" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("(empty directory)");
  });

  it("lists dirs first then files alpha, with dotfiles and sizes", async () => {
    mkdirSync(path.join(root, "sub"));
    write(root, ".hidden", "h");
    write(root, "a.txt", "aa");
    write(root, "b.txt", "bbb");
    const r = await callTool("list_dir", {}, config);
    expect(r.text).toBe("sub/\n.hidden\t1\na.txt\t2\nb.txt\t3");
  });

  it("defaults to the workspace root", async () => {
    write(root, "only.txt", "x");
    const r = await callTool("list_dir", {}, config);
    expect(r.text).toBe("only.txt\t1");
  });

  it("errors not_found for a missing directory", async () => {
    const r = await callTool("list_dir", { path: "nope" }, config);
    expect(r.json.error).toBe("not_found");
  });

  it("errors not_a_file when path is a file", async () => {
    write(root, "f.txt", "x");
    const r = await callTool("list_dir", { path: "f.txt" }, config);
    expect(r.json.error).toBe("not_a_file");
  });

  it("classifies a symlink-to-directory as a directory (trailing /, sorted with dirs)", async () => {
    mkdirSync(path.join(root, "realdir"));
    symlinkSync(path.join(root, "realdir"), path.join(root, "linkdir"));
    write(root, "plain.txt", "y");
    const r = await callTool("list_dir", {}, config);
    expect(r.text).toBe("linkdir/\nrealdir/\nplain.txt\t1");
  });

  it("rejects out-of-schema input with invalid_input", async () => {
    const r = await callTool("list_dir", { bogus: true }, config);
    expect(r.json.error).toBe("invalid_input");
  });
});
