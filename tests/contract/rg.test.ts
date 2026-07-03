import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { makeWorkspace, cleanup, makeConfig, callTool, write } from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

const rgAvailable = (() => {
  try {
    return spawnSync("rg", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
})();

describe.skipIf(!rgAvailable)("ripgrep single-file search", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { ripgrepAvailable: true });
  });
  afterEach(() => cleanup(root));

  it("searches a single file at the workspace root and reports its path", async () => {
    write(root, "hello.txt", "needle here\nother\n");
    const r = await callTool(
      "grep",
      { pattern: "needle", path: "hello.txt", output_mode: "content" },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("hello.txt:1:needle here");
  });

  it("searches a single nested file, reporting the workspace-relative path", async () => {
    write(root, "sub/deep/note.txt", "needle inside\n");
    const r = await callTool(
      "grep",
      { pattern: "needle", path: "sub/deep/note.txt", output_mode: "content" },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("sub/deep/note.txt:1:needle inside");
  });
});

describe.skipIf(!rgAvailable)("ripgrep stream-cap truncation", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { ripgrepAvailable: true, maxOutputBytes: 1 });
  });
  afterEach(() => cleanup(root));

  it("kills ripgrep once output exceeds the stream cap and reports an incomplete scan", async () => {
    write(root, "giant.txt", "y".repeat(500000) + "\n");
    const r = await callTool("grep", { pattern: "y", output_mode: "content" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("search incomplete");
  });

  it("reports an incomplete scan after parsing some complete matches", async () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `hit ${i}`).join("\n");
    write(root, "many.txt", lines + "\n");
    const r = await callTool("grep", { pattern: "hit" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("search incomplete");
  });
});

describe.skipIf(!rgAvailable)("ripgrep non-UTF-8 output", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { ripgrepAvailable: true });
  });
  afterEach(() => cleanup(root));

  it("matches a line whose bytes are not valid UTF-8", async () => {
    const body = Buffer.concat([
      Buffer.from("needle "),
      Buffer.from([0xff]),
      Buffer.from(" tail\n"),
    ]);
    writeFileSync(`${root}/badline.txt`, body);
    const r = await callTool(
      "grep",
      { pattern: "needle", path: "badline.txt", output_mode: "content" },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("badline.txt:1:");
  });

  it("skips a match whose path is not valid UTF-8", async () => {
    const badName = Buffer.concat([
      Buffer.from(`${root}/bad-`),
      Buffer.from([0xff]),
      Buffer.from(".txt"),
    ]);
    writeFileSync(badName, "needle here\n");
    const r = await callTool("grep", { pattern: "needle", output_mode: "content" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("(no matches)");
  });
});
