import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  write,
  read,
  chmod,
  mode,
  isRoot,
} from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("write_file", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  describe("writing content", () => {
    it("creates a file (and parent dirs), writing content verbatim", async () => {
      const r = await callTool("write_file", { path: "x/y/z.txt", content: "hi" }, config);
      expect(r.isError).toBe(false);
      expect(r.text).toContain("(created)");
      expect(read(root, "x/y/z.txt")).toBe("hi");
    });

    it("overwrites an existing file", async () => {
      write(root, "f.txt", "old");
      const r = await callTool("write_file", { path: "f.txt", content: "new" }, config);
      expect(r.text).toContain("(overwritten)");
      expect(read(root, "f.txt")).toBe("new");
    });

    it("preserves the mode of an overwritten file", async () => {
      write(root, "s.sh", "echo a\n");
      chmod(root, "s.sh", 0o755);
      const r = await callTool("write_file", { path: "s.sh", content: "echo b\n" }, config);
      expect(r.isError).toBe(false);
      expect(mode(root, "s.sh")).toBe(0o755);
    });
  });

  describe("atomicity and symlink safety", () => {
    it("is atomic: a failed write leaves an existing file unchanged", async () => {
      write(root, "f", "intact");
      const r = await callTool("write_file", { path: "f/child", content: "x" }, config);
      expect(r.isError).toBe(true);
      expect(read(root, "f")).toBe("intact");
    });

    it.skipIf(isRoot)(
      "reports io_error when the write fails under a read-only directory",
      async () => {
        mkdirSync(path.join(root, "ro"));
        chmod(root, "ro", 0o555);
        try {
          const r = await callTool("write_file", { path: "ro/new.txt", content: "x" }, config);
          expect(r.isError).toBe(true);
          expect(r.json.error).toBe("io_error");
        } finally {
          chmod(root, "ro", 0o755);
        }
      },
    );

    it("refuses to write through a symlink and reports invalid_input", async () => {
      write(root, "real.txt", "original");
      symlinkSync(path.join(root, "real.txt"), path.join(root, "link.txt"));
      const r = await callTool("write_file", { path: "link.txt", content: "new" }, config);
      expect(r.isError).toBe(true);
      expect(r.json.error).toBe("invalid_input");
      expect(String(r.json.message)).toContain("symlink");
    });
  });

  describe("input and error contract", () => {
    it("errors not_a_file when path is an existing directory", async () => {
      mkdirSync(path.join(root, "d"));
      const r = await callTool("write_file", { path: "d", content: "x" }, config);
      expect(r.json.error).toBe("not_a_file");
    });

    it("rejects out-of-schema input with invalid_input", async () => {
      const r = await callTool("write_file", { path: "a.txt", content: "x", bogus: 1 }, config);
      expect(r.json.error).toBe("invalid_input");
    });
  });
});
