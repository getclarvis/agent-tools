import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { utimesSync } from "node:fs";
import path from "node:path";
import { makeWorkspace, cleanup, makeConfig, callTool, write } from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("glob", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("returns matches sorted by mtime (most recent first)", async () => {
    write(root, "old.ts", "a");
    write(root, "new.ts", "b");
    utimesSync(path.join(root, "old.ts"), new Date(1000), new Date(1000));
    utimesSync(path.join(root, "new.ts"), new Date(2000), new Date(2000));
    const r = await callTool("glob", { pattern: "**/*.ts" }, config);
    expect(r.text).toBe("new.ts\nold.ts");
  });

  it("excludes .gitignore'd files by default", async () => {
    write(root, "keep.ts", "a");
    write(root, ".gitignore", "node_modules/\n");
    write(root, "node_modules/dep.ts", "b");
    const r = await callTool("glob", { pattern: "**/*.ts" }, config);
    expect(r.text).toBe("keep.ts");
  });

  it("includes ignored files when respect_gitignore is false", async () => {
    write(root, "keep.ts", "a");
    write(root, ".gitignore", "node_modules/\n");
    write(root, "node_modules/dep.ts", "b");
    const r = await callTool("glob", { pattern: "**/*.ts", respect_gitignore: false }, config);
    const lines = r.text.split("\n").sort();
    expect(lines).toEqual(["keep.ts", "node_modules/dep.ts"]);
  });

  it("returns (no matches) as a success when nothing matches", async () => {
    write(root, "a.js", "x");
    const r = await callTool("glob", { pattern: "**/*.ts" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("(no matches)");
  });

  it("errors not_found for a missing base path", async () => {
    const r = await callTool("glob", { pattern: "*", path: "nope" }, config);
    expect(r.json.error).toBe("not_found");
  });

  it("rejects out-of-schema input with invalid_input", async () => {
    const r = await callTool("glob", { pattern: "*", bogus: 1 }, config);
    expect(r.json.error).toBe("invalid_input");
  });
});
