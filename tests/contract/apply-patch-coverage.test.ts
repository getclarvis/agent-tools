import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  write,
  read,
  exists,
} from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("apply_patch (coverage)", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("reports invalid_input when the +++ header is missing (parsePatch throws)", async () => {
    const patch = `--- a/f\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("invalid_input");
    expect(r.text).toContain("Malformed patch");
  });

  it("rejects a same-name block with no hunks as not actionable", async () => {
    const patch = `--- a/x.txt\n+++ b/x.txt\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("invalid_input");
    expect(r.text).toContain("no applicable hunks");
  });

  it("rejects a /dev/null -> /dev/null block with no hunks as not actionable", async () => {
    const patch = `--- /dev/null\n+++ /dev/null\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("invalid_input");
    expect(r.text).toContain("no applicable hunks");
  });

  it("rejects a /dev/null -> /dev/null block that carries a hunk (missing valid path)", async () => {
    const patch = `--- /dev/null\n+++ /dev/null\n@@ -0,0 +1,1 @@\n+x\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("invalid_input");
    expect(r.text).toContain("missing a valid file path");
  });

  it("reports patch_failed when a rename's hunk does not apply cleanly", async () => {
    write(root, "old.txt", "actual content\n");
    const patch = `--- a/old.txt\n+++ b/new.txt\n@@ -1,1 +1,1 @@\n-WRONGCONTEXT\n+X\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("patch_failed");
    expect(r.json.file).toBe("old.txt");
    expect(r.json.hunk).toBe(1);
    expect(read(root, "old.txt")).toBe("actual content\n");
    expect(exists(root, "new.txt")).toBe(false);
  });

  it("names the second hunk when an earlier hunk applies but a later one fails", async () => {
    write(root, "m.txt", "1\n2\n3\n4\n5\n");
    const patch =
      `--- a/m.txt\n+++ b/m.txt\n` +
      `@@ -1,1 +1,1 @@\n-1\n+ONE\n` +
      `@@ -3,1 +3,1 @@\n-WRONGCONTEXT\n+X\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("patch_failed");
    expect(r.json.file).toBe("m.txt");
    expect(r.json.hunk).toBe(2);
    expect(read(root, "m.txt")).toBe("1\n2\n3\n4\n5\n");
  });

  it("reports patch_failed with no hunk number when the combined patch fails but each hunk applies alone", async () => {
    write(root, "f.txt", "NEEDLE\na\nb\nKEY\nc\nd\n");
    const patch =
      `--- a/f.txt\n+++ b/f.txt\n` +
      `@@ -4,1 +4,1 @@\n-KEY\n+KEY2\n` +
      `@@ -6,1 +6,1 @@\n-NEEDLE\n+NEEDLE2\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("patch_failed");
    expect(r.json.file).toBe("f.txt");
    expect(r.json.hunk).toBeUndefined();
    expect(read(root, "f.txt")).toBe("NEEDLE\na\nb\nKEY\nc\nd\n");
  });

  it("hits cleanName's undefined guard for a headerless hunk-only patch", async () => {
    const patch = `@@ -1,1 +1,1 @@\n-a\n+b\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("invalid_input");
    expect(r.text).toContain("missing a valid file path");
  });

  it("applies a straightforward modify hunk and reencodes via the decoded source", async () => {
    write(root, "mod.txt", "hello\nworld\n");
    const patch = `--- a/mod.txt\n+++ b/mod.txt\n@@ -1,2 +1,2 @@\n-hello\n+HELLO\n world\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBeUndefined();
    expect(r.text).toContain("Applied patch");
    expect(r.text).toContain("M mod.txt");
    expect(read(root, "mod.txt")).toBe("HELLO\nworld\n");
  });

  it("strips a tab-timestamp header and still applies the modify", async () => {
    write(root, "ts.txt", "x\ny\n");
    const patch =
      `--- a/ts.txt\t2020-01-01 00:00:00\n` +
      `+++ b/ts.txt\t2020-01-02 00:00:00\n` +
      `@@ -1,2 +1,2 @@\n-x\n+X\n y\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBeUndefined();
    expect(read(root, "ts.txt")).toBe("X\ny\n");
  });

  it("creates a new file from a /dev/null hunk", async () => {
    const patch = `--- /dev/null\n+++ b/created.txt\n@@ -0,0 +1,2 @@\n+line1\n+line2\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBeUndefined();
    expect(r.text).toContain("A created.txt");
    expect(read(root, "created.txt")).toBe("line1\nline2\n");
  });

  it("rejects a create whose target already exists", async () => {
    write(root, "dup.txt", "existing\n");
    const patch = `--- /dev/null\n+++ b/dup.txt\n@@ -0,0 +1,1 @@\n+new\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("invalid_input");
    expect(r.text).toContain("already exists");
    expect(read(root, "dup.txt")).toBe("existing\n");
  });

  it("surfaces a non-ENOENT stat error when creating under a file-as-directory", async () => {
    write(root, "notdir", "iamafile\n");
    const patch = `--- /dev/null\n+++ b/notdir/child.txt\n@@ -0,0 +1,1 @@\n+x\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("not_a_file");
    expect(exists(root, "notdir/child.txt")).toBe(false);
  });

  it("treats a rename whose paths resolve to the same file as a plain modify", async () => {
    write(root, "same.txt", "a\nb\n");
    const patch = `--- a/same.txt\n+++ b/./same.txt\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBeUndefined();
    expect(r.text).toContain("M same.txt");
    expect(read(root, "same.txt")).toBe("A\nb\n");
    expect(exists(root, "./same.txt")).toBe(true);
  });

  it("renames a file and applies its content changes", async () => {
    write(root, "from.txt", "one\ntwo\n");
    const patch = `--- a/from.txt\n+++ b/to.txt\n@@ -1,2 +1,2 @@\n-one\n+ONE\n two\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBeUndefined();
    expect(r.text).toContain("R from.txt -> to.txt");
    expect(read(root, "to.txt")).toBe("ONE\ntwo\n");
    expect(exists(root, "from.txt")).toBe(false);
  });

  it("performs a pure rename (no hunks) without touching content", async () => {
    write(root, "keep-a.txt", "keep\n");
    const patch = `--- a/keep-a.txt\n+++ b/keep-b.txt\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBeUndefined();
    expect(r.text).toContain("R keep-a.txt -> keep-b.txt");
    expect(read(root, "keep-b.txt")).toBe("keep\n");
    expect(exists(root, "keep-a.txt")).toBe(false);
  });

  it("reports a rename patch_failed with no hunk number when each hunk applies alone", async () => {
    write(root, "ren.txt", "NEEDLE\na\nb\nKEY\nc\nd\n");
    const patch =
      `--- a/ren.txt\n+++ b/ren2.txt\n` +
      `@@ -4,1 +4,1 @@\n-KEY\n+KEY2\n` +
      `@@ -6,1 +6,1 @@\n-NEEDLE\n+NEEDLE2\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBe("patch_failed");
    expect(r.json.file).toBe("ren.txt");
    expect(r.json.hunk).toBeUndefined();
    expect(read(root, "ren.txt")).toBe("NEEDLE\na\nb\nKEY\nc\nd\n");
    expect(exists(root, "ren2.txt")).toBe(false);
  });

  it("deletes a file whose delete hunk removes all content", async () => {
    write(root, "del.txt", "gone\n");
    const patch = `--- a/del.txt\n+++ /dev/null\n@@ -1,1 +1,0 @@\n-gone\n`;
    const r = await callTool("apply_patch", { patch }, config);
    expect(r.json.error).toBeUndefined();
    expect(r.text).toContain("D del.txt");
    expect(exists(root, "del.txt")).toBe(false);
  });
});
