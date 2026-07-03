import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, symlinkSync, utimesSync } from "node:fs";
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

const mockState = vi.hoisted(() => ({ throwInListFiles: false }));

type ListFilesFn = (
  base: string,
  workspaceRoot: string,
  opts: { pattern: string; respectGitignore: boolean },
) => Promise<string[]>;

vi.mock("../../src/lib/files.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const realListFiles = actual.listFiles as ListFilesFn;
  const listFiles: ListFilesFn = async (base, workspaceRoot, opts) => {
    if (mockState.throwInListFiles) throw new Error("simulated tinyglob failure");
    return realListFiles(base, workspaceRoot, opts);
  };
  return { ...actual, listFiles };
});

describe("glob coverage", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
    mockState.throwInListFiles = false;
  });
  afterEach(() => {
    mockState.throwInListFiles = false;
    cleanup(root);
  });

  it("wraps a listFiles failure as invalid_input (glob.ts:50)", async () => {
    write(root, "a.ts", "x");
    mockState.throwInListFiles = true;
    try {
      const r = await callTool("glob", { pattern: "**/*.ts" }, config);
      expect(r.isError).toBe(true);
      expect(r.json.error).toBe("invalid_input");
      expect(r.json.message).toContain("simulated tinyglob failure");
    } finally {
      mockState.throwInListFiles = false;
    }
  });

  it("breaks mtime ties by path ascending (glob.ts:68 tiebreak arms)", async () => {
    write(root, "c.ts", "1");
    write(root, "a.ts", "2");
    write(root, "b.ts", "3");
    const same = new Date(1_700_000_000_000);
    for (const name of ["a.ts", "b.ts", "c.ts"]) {
      utimesSync(path.join(root, name), same, same);
    }
    const r = await callTool("glob", { pattern: "**/*.ts", respect_gitignore: false }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("a.ts\nb.ts\nc.ts");
  });

  it.skipIf(isRoot)(
    "drops files whose stat fails, yielding (no matches) (glob.ts:59)",
    async () => {
      write(root, "sub/a.ts", "x");
      chmod(root, "sub", 0o444);
      try {
        const r = await callTool("glob", { pattern: "sub/*.ts", respect_gitignore: false }, config);
        expect(r.isError).toBe(false);
        expect(r.text).toBe("(no matches)");
      } finally {
        chmod(root, "sub", 0o755);
      }
    },
  );
});

describe("list_dir coverage", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("treats a broken symlink as a zero-size file amid a mix (list-dir.ts:49,46-47,56-57)", async () => {
    mkdirSync(path.join(root, "sub"));
    write(root, "file.txt", "aa");
    symlinkSync(path.join(root, "does-not-exist"), path.join(root, "zlink"));
    const r = await callTool("list_dir", {}, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("sub/\nfile.txt\t2\nzlink\t0");
  });

  it.skipIf(isRoot)("surfaces a readdir failure as an io error (list-dir.ts:37)", async () => {
    mkdirSync(path.join(root, "locked"));
    chmod(root, "locked", 0o000);
    try {
      const r = await callTool("list_dir", { path: "locked" }, config);
      expect(r.isError).toBe(true);
      expect(r.json.error).toBe("io_error");
    } finally {
      chmod(root, "locked", 0o755);
    }
  });

  it("orders directories before files and each group alphabetically (list-dir.ts:56-57)", async () => {
    mkdirSync(path.join(root, "delta"));
    mkdirSync(path.join(root, "beta"));
    write(root, "gamma.txt", "y");
    write(root, "alpha.txt", "xx");
    write(root, "omega.txt", "zzz");
    const r = await callTool("list_dir", {}, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("beta/\ndelta/\nalpha.txt\t2\ngamma.txt\t1\nomega.txt\t3");
  });

  it("reports an empty directory (list-dir.ts:60)", async () => {
    mkdirSync(path.join(root, "hollow"));
    const r = await callTool("list_dir", { path: "hollow" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("(empty directory)");
  });
});
