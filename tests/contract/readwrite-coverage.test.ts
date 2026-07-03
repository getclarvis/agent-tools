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

describe("write_file / read_file uncovered branches", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it.skipIf(isRoot)(
    "maps a non-ToolError from writeAtomic through fsError (io_error)",
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

  it("rethrows a ToolError from writeAtomic verbatim (symlink refusal)", async () => {
    write(root, "real.txt", "original");
    symlinkSync(path.join(root, "real.txt"), path.join(root, "link.txt"));
    const r = await callTool("write_file", { path: "link.txt", content: "new" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("invalid_input");
    expect(String(r.json.message)).toContain("symlink");
  });

  it("backs off a mid-character cut when byte-capping a multibyte line (1 decrement)", async () => {
    const small = makeConfig(root, { maxOutputBytes: 100 });
    write(root, "euro.txt", "€".repeat(300) + "\n");
    const r = await callTool("read_file", { path: "euro.txt" }, small);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("line truncated");
    expect(r.text).not.toContain("�");
    for (const line of r.text.split("\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(100);
    }
  });

  it("backs off a mid-character cut when byte-capping a multibyte line (2 decrements)", async () => {
    const small = makeConfig(root, { maxOutputBytes: 101 });
    write(root, "euro2.txt", "€".repeat(300) + "\n");
    const r = await callTool("read_file", { path: "euro2.txt" }, small);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("line truncated");
    expect(r.text).not.toContain("�");
    for (const line of r.text.split("\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(101);
    }
  });

  it("emits multiple numbered lines through the read loop body", async () => {
    write(root, "multi.txt", "alpha\nbeta\ngamma\ndelta\n");
    const r = await callTool("read_file", { path: "multi.txt", offset: 2, limit: 2 }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe(
      "     2\tbeta\n     3\tgamma\n[... 2 of 4 lines shown; continue with offset=4 ...]",
    );
  });
});
