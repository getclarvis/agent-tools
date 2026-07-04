import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  write,
  writeBinary,
  writeUtf16,
} from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

let root: string;
let config: ServerConfig;

beforeEach(() => {
  root = makeWorkspace();
  config = makeConfig(root);
});
afterEach(() => cleanup(root));

describe("read_files — batch read", () => {
  it("reads several files, each under a numbered header", async () => {
    write(root, "a.txt", "alpha\nbeta\n");
    write(root, "b.txt", "gamma\n");
    const r = await callTool("read_files", { paths: ["a.txt", "b.txt"] }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("==> a.txt <==");
    expect(r.text).toContain("     1\talpha");
    expect(r.text).toContain("     2\tbeta");
    expect(r.text).toContain("==> b.txt <==");
    expect(r.text).toContain("     1\tgamma");
  });

  it("marks an empty file", async () => {
    write(root, "empty.txt", "");
    const r = await callTool("read_files", { paths: ["empty.txt"] }, config);
    expect(r.text).toContain("==> empty.txt <==");
    expect(r.text).toContain("(empty file)");
  });

  it("reports a per-entry error without failing the batch", async () => {
    write(root, "ok.txt", "fine\n");
    writeBinary(root, "bin.dat");
    const r = await callTool("read_files", { paths: ["missing.txt", "bin.dat", "ok.txt"] }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/missing\.txt[^\n]*not_found/);
    expect(r.text).toMatch(/bin\.dat[^\n]*is_binary/);
    expect(r.text).toContain("     1\tfine");
  });

  it("flags a directory entry as not_a_file without derailing", async () => {
    write(root, "sub/x.txt", "hi\n");
    const r = await callTool("read_files", { paths: ["sub"] }, config);
    expect(r.text).toMatch(/sub[^\n]*not_a_file/);
  });

  it("surfaces an escaping path as a per-entry path_escape", async () => {
    const r = await callTool("read_files", { paths: ["../secret"] }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/\.\.\/secret[^\n]*path_escape/);
  });

  it("reads UTF-16 content", async () => {
    writeUtf16(root, "u.txt", "wide\n");
    const r = await callTool("read_files", { paths: ["u.txt"] }, config);
    expect(r.text).toContain("     1\twide");
  });

  it("drops later files when the combined budget runs out", async () => {
    const bigLine = "x".repeat(400);
    for (let i = 0; i < 6; i++) {
      write(root, `f${i}.txt`, `${bigLine}\n`.repeat(20));
    }
    const small = makeConfig(root, { maxOutputBytes: 2000 });
    const r = await callTool(
      "read_files",
      { paths: ["f0.txt", "f1.txt", "f2.txt", "f3.txt", "f4.txt", "f5.txt"] },
      small,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toContain("more file(s) not shown");
  });

  it("rejects an empty paths array via schema", async () => {
    const r = await callTool("read_files", { paths: [] }, config);
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: "invalid_input" });
  });

  it("rejects more than sixty-four paths via schema", async () => {
    const many = Array.from({ length: 65 }, (_, i) => `f${i}.txt`);
    const r = await callTool("read_files", { paths: many }, config);
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: "invalid_input" });
  });
});
