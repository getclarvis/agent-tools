import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  write,
  read,
  exists,
  writeBinary,
  writeUtf16,
  chmod,
  mode,
  isRoot,
} from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("apply_patch", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("modifies a file", async () => {
    write(root, "f.txt", "line1\nline2\nline3\n");
    const patch = `--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n line1\n-line2\n+CHANGED\n line3\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("M f.txt");
    expect(read(root, "f.txt")).toMatch(/^line1\nCHANGED\nline3\n?$/);
  });

  it("creates a file", async () => {
    const patch = `--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("A new.txt");
    expect(read(root, "new.txt")).toMatch(/^hello\nworld\n?$/);
  });

  it("deletes a file", async () => {
    write(root, "del.txt", "bye\n");
    const patch = `--- a/del.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-bye\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("D del.txt");
    expect(exists(root, "del.txt")).toBe(false);
  });

  it("rejects a delete patch that does not remove the whole file (BUG-15)", async () => {
    write(root, "f.txt", "a\nb\n");
    const patch = `--- a/f.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-a\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("invalid_input");
    expect(read(root, "f.txt")).toBe("a\nb\n");
  });

  it("is atomic across files: a failed hunk changes nothing and reports file+hunk", async () => {
    write(root, "ok.txt", "aaa\n");
    write(root, "bad.txt", "bbb\n");
    const patch =
      `--- a/ok.txt\n+++ b/ok.txt\n@@ -1,1 +1,1 @@\n-aaa\n+AAA\n` +
      `--- a/bad.txt\n+++ b/bad.txt\n@@ -1,1 +1,1 @@\n-WRONGCONTEXT\n+X\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("patch_failed");
    expect(r.json.file).toBe("bad.txt");
    expect(r.json.hunk).toBe(1);
    expect(read(root, "ok.txt")).toBe("aaa\n");
  });

  it("errors is_binary for a binary target", async () => {
    writeBinary(root, "bin");
    const patch = `--- a/bin\n+++ b/bin\n@@ -1,1 +1,1 @@\n-a\n+b\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("is_binary");
  });

  it("refuses to patch a UTF-16 file (no silent transcode to UTF-8)", async () => {
    writeUtf16(root, "u16.txt", "hello\nworld\n");
    const patch = `--- a/u16.txt\n+++ b/u16.txt\n@@ -1,2 +1,2 @@\n-hello\n+HELLO\n world\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("is_binary");
  });

  it("rejects out-of-schema input with invalid_input", async () => {
    const r = await callTool("apply_patch", { patch: "x", bogus: 1 }, config);
    expect(r.json.error).toBe("invalid_input");
  });

  it("refuses to clobber an existing file with a /dev/null create", async () => {
    write(root, "exists.txt", "keep me\n");
    const patch = `--- /dev/null\n+++ b/exists.txt\n@@ -0,0 +1,1 @@\n+clobber\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("invalid_input");
    expect(read(root, "exists.txt")).toBe("keep me\n");
  });

  it("renames a file with no content change (pure rename)", async () => {
    write(root, "old.txt", "hello\nworld\n");
    const patch = `--- a/old.txt\n+++ b/new.txt\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("R old.txt -> new.txt");
    expect(exists(root, "old.txt")).toBe(false);
    expect(read(root, "new.txt")).toBe("hello\nworld\n");
  });

  it("moves and edits a file, creating the destination dir and preserving CRLF+BOM", async () => {
    write(root, "old.txt", "﻿hello\r\nworld\r\n");
    const patch = `--- a/old.txt\n+++ b/sub/new.txt\n@@ -1,2 +1,2 @@\n-hello\n+HELLO\n world\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("R old.txt -> sub/new.txt");
    expect(exists(root, "old.txt")).toBe(false);
    expect(read(root, "sub/new.txt")).toBe("﻿HELLO\r\nworld\r\n");
  });

  it("refuses a rename whose destination already exists and changes nothing", async () => {
    write(root, "old.txt", "a\n");
    write(root, "new.txt", "keep me\n");
    const patch = `--- a/old.txt\n+++ b/new.txt\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("invalid_input");
    expect(read(root, "old.txt")).toBe("a\n");
    expect(read(root, "new.txt")).toBe("keep me\n");
  });

  it("refuses a rename chain that reuses an endpoint (A->B, B->C)", async () => {
    write(root, "a.txt", "1\n");
    write(root, "b.txt", "2\n");
    const patch = `--- a/a.txt\n+++ b/b.txt\n` + `--- a/b.txt\n+++ b/c.txt\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("invalid_input");
    expect(exists(root, "a.txt")).toBe(true);
    expect(exists(root, "c.txt")).toBe(false);
  });

  it("preserves the mode of a renamed file", async () => {
    write(root, "run.sh", "echo hi\n");
    chmod(root, "run.sh", 0o755);
    const patch = `--- a/run.sh\n+++ b/run2.sh\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.isError).toBe(false);
    expect(exists(root, "run.sh")).toBe(false);
    expect(mode(root, "run2.sh")).toBe(0o755);
  });

  it("errors not_found when the rename source does not exist", async () => {
    const patch = `--- a/nope.txt\n+++ b/new.txt\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("not_found");
  });

  it("errors not_a_file when the rename source is a directory", async () => {
    mkdirSync(path.join(root, "dir"));
    const patch = `--- a/dir\n+++ b/dir2\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("not_a_file");
  });

  it.skipIf(isRoot)(
    "rolls back a rename when a later op in the batch fails at commit",
    async () => {
      write(root, "old.txt", "keep\n");
      mkdirSync(path.join(root, "sub"));
      write(root, "sub/B.txt", "bye\n");
      chmod(root, "sub", 0o500);
      const patch =
        `--- a/old.txt\n+++ b/moved.txt\n@@ -1,1 +1,1 @@\n-keep\n+CHANGED\n` +
        `--- a/sub/B.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-bye\n`;
      const r = await callTool("apply_patch", { patch }, config);
      expect(r.isError).toBe(true);

      expect(read(root, "old.txt")).toBe("keep\n");
      expect(exists(root, "moved.txt")).toBe(false);
      expect(exists(root, "sub/B.txt")).toBe(true);
      chmod(root, "sub", 0o700);
      expect(readdirSync(root).filter((f) => f.startsWith(".clarvis-tmp"))).toHaveLength(0);
    },
  );

  it("refuses multiple blocks targeting the same file (no silent last-wins)", async () => {
    write(root, "g.txt", "x1\nx2\nx3\n");
    const patch =
      `--- a/g.txt\n+++ b/g.txt\n@@ -1,1 +1,1 @@\n-x1\n+X1\n` +
      `--- a/g.txt\n+++ b/g.txt\n@@ -3,1 +3,1 @@\n-x3\n+X3\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("invalid_input");
    expect(read(root, "g.txt")).toBe("x1\nx2\nx3\n");
  });

  it("preserves the executable bit of a modified file", async () => {
    write(root, "x.sh", "echo a\n");
    chmod(root, "x.sh", 0o755);
    const patch = `--- a/x.sh\n+++ b/x.sh\n@@ -1,1 +1,1 @@\n-echo a\n+echo b\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.isError).toBe(false);
    expect(mode(root, "x.sh")).toBe(0o755);
  });

  it.skipIf(isRoot)(
    "is all-or-nothing across the commit phase: a delete that cannot apply rolls back the modify",
    async () => {
      write(root, "A.txt", "line1\n");
      mkdirSync(path.join(root, "sub"));
      write(root, "sub/B.txt", "bye\n");
      chmod(root, "sub", 0o500);
      const patch =
        `--- a/A.txt\n+++ b/A.txt\n@@ -1,1 +1,1 @@\n-line1\n+CHANGED\n` +
        `--- a/sub/B.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-bye\n`;
      const r = await callTool("apply_patch", { patch }, config);
      expect(r.isError).toBe(true);

      expect(read(root, "A.txt")).toBe("line1\n");
      expect(exists(root, "sub/B.txt")).toBe(true);
      chmod(root, "sub", 0o700);
      expect(readdirSync(root).filter((f) => f.startsWith(".clarvis-tmp"))).toHaveLength(0);
    },
  );
});
