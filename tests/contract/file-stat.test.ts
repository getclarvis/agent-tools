import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  write,
  writeBinary,
  writePng,
  chmod,
  isRoot,
} from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("file_stat", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("reports a regular text file: type, size, mode, not binary, no mime", async () => {
    write(root, "a.txt", "hello");
    const r = await callTool("file_stat", { path: "a.txt" }, config);
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({
      path: "a.txt",
      type: "file",
      size: 5,
      binary: false,
      mime: null,
    });
    expect(r.json.mode).toMatch(/^0[0-7]{3}$/);
    expect(typeof r.json.mtime).toBe("string");
  });

  it("flags a binary file", async () => {
    writeBinary(root, "a.bin");
    const r = await callTool("file_stat", { path: "a.bin" }, config);
    expect(r.json.binary).toBe(true);
  });

  it("detects an image MIME from magic bytes", async () => {
    writePng(root, "img.png");
    const r = await callTool("file_stat", { path: "img.png" }, config);
    expect(r.json).toMatchObject({ type: "file", mime: "image/png", binary: true });
  });

  it("reports a directory", async () => {
    mkdirSync(path.join(root, "d"));
    const r = await callTool("file_stat", { path: "d" }, config);
    expect(r.json).toMatchObject({ type: "directory" });
  });

  it("reports a symlink without following it, including its target", async () => {
    write(root, "real.txt", "x");
    symlinkSync(path.join(root, "real.txt"), path.join(root, "link.txt"));
    const r = await callTool("file_stat", { path: "link.txt" }, config);
    expect(r.json.type).toBe("symlink");
    expect(String(r.json.symlink_target)).toContain("real.txt");
  });

  it("works on a file larger than maxFileBytes (heads only, no too_large)", async () => {
    const small = makeConfig(root, { maxFileBytes: 1024 });
    writeFileSync(path.join(root, "big.txt"), "a".repeat(4096));
    const r = await callTool("file_stat", { path: "big.txt" }, small);
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ type: "file", size: 4096, binary: false });
  });

  it("reports a non-regular file (socket) as type other", async () => {
    const sock = path.join(root, "s.sock");
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(sock, resolve));
    try {
      const r = await callTool("file_stat", { path: "s.sock" }, config);
      expect(r.json.type).toBe("other");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("errors not_found for a missing path", async () => {
    const r = await callTool("file_stat", { path: "nope" }, config);
    expect(r.json.error).toBe("not_found");
  });

  it.skipIf(isRoot)("reports io_error when the file is unreadable", async () => {
    write(root, "secret.txt", "x");
    chmod(root, "secret.txt", 0o000);
    try {
      const r = await callTool("file_stat", { path: "secret.txt" }, config);
      expect(r.isError).toBe(true);
      expect(r.json.error).toBe("io_error");
    } finally {
      chmod(root, "secret.txt", 0o644);
    }
  });

  it("rejects a path escaping the workspace with path_escape", async () => {
    const r = await callTool("file_stat", { path: "../x" }, config);
    expect(r.json.error).toBe("path_escape");
  });

  it("rejects out-of-schema input with invalid_input", async () => {
    const r = await callTool("file_stat", { path: "a", bogus: true }, config);
    expect(r.json.error).toBe("invalid_input");
  });
});
