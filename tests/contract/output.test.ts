import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fsp, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import path from "node:path";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  write,
  exists,
  read,
} from "../helpers/fixtures.js";
import { allocateBudget, bound, boundOrSpill, sweepSpillDir } from "../../src/lib/output.js";
import type { ServerConfig } from "../../src/config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("bound()", () => {
  it("returns the input unchanged when it fits", () => {
    expect(bound("short", 1000)).toBe("short");
  });

  it("appends the truncation marker when oversized", () => {
    const out = bound("x".repeat(200), 50);
    expect(out).toMatch(/\[\.\.\. output truncated: \d+ of 200 bytes shown \.\.\.\]$/);
    expect(out.startsWith("x".repeat(50))).toBe(true);
  });

  it("never splits a multibyte character at the cut boundary", () => {
    for (const ch of ["😀", "中"]) {
      const out = bound(ch.repeat(50), 10);
      expect(out).not.toContain("�");
      const shown = out.split("\n[...")[0]!;
      expect(Buffer.from(shown, "utf8").toString("utf8")).toBe(shown);
    }
  });
});

describe("allocateBudget()", () => {
  it("keeps both when they fit within total", () => {
    expect(allocateBudget(10, 20, 100)).toEqual([10, 20]);
  });

  it("gives a its ask and the rest to b when a is within half", () => {
    expect(allocateBudget(20, 200, 100)).toEqual([20, 80]);
  });

  it("gives b its ask and the rest to a when b is within half", () => {
    expect(allocateBudget(200, 20, 100)).toEqual([80, 20]);
  });

  it("splits evenly when both exceed half", () => {
    expect(allocateBudget(200, 200, 100)).toEqual([50, 50]);
  });
});

describe("sweepSpillDir()", () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup(root);
  });

  it("returns quietly when the spill directory does not exist", async () => {
    await expect(sweepSpillDir(root)).resolves.toBeUndefined();
    expect(exists(root, ".clarvis")).toBe(false);
  });

  it("removes stale bash- spill files but keeps fresh ones and non-spill entries", async () => {
    const dir = path.join(root, ".clarvis");
    mkdirSync(dir, { recursive: true });

    const stale = path.join(dir, "bash-stale.txt");
    writeFileSync(stale, "old");
    const staleTime = new Date(Date.now() - 2 * DAY_MS);
    utimesSync(stale, staleTime, staleTime);

    writeFileSync(path.join(dir, "bash-fresh.txt"), "new");
    mkdirSync(path.join(dir, "bash-subdir"), { recursive: true });
    writeFileSync(path.join(dir, "keep.txt"), "keep");

    await sweepSpillDir(root);

    expect(exists(root, ".clarvis/bash-stale.txt")).toBe(false);
    expect(exists(root, ".clarvis/bash-fresh.txt")).toBe(true);
    expect(exists(root, ".clarvis/bash-subdir")).toBe(true);
    expect(exists(root, ".clarvis/keep.txt")).toBe(true);
  });

  it("swallows a stat failure and leaves the file in place", async () => {
    const dir = path.join(root, ".clarvis");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "bash-x.txt"), "data");

    const spy = vi.spyOn(fsp, "stat").mockRejectedValue(new Error("boom"));

    await expect(sweepSpillDir(root)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    expect(exists(root, ".clarvis/bash-x.txt")).toBe(true);
  });
});

describe("boundOrSpill()", () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup(root);
  });

  it("returns the text unchanged when it fits within maxBytes", async () => {
    const text = "small";
    const out = await boundOrSpill(text, 1000, {
      absPath: path.join(root, ".clarvis", "bash-stdout.txt"),
      displayPath: ".clarvis/bash-stdout.txt",
    });
    expect(out).toBe(text);
    expect(exists(root, ".clarvis/bash-stdout.txt")).toBe(false);
  });

  it("spills the full output, keeps the TAIL inline, and writes a .gitignore", async () => {
    const text = "HEAD" + "A".repeat(500) + "TAIL";
    const out = await boundOrSpill(text, 50, {
      absPath: path.join(root, ".clarvis", "bash-stdout.txt"),
      displayPath: ".clarvis/bash-stdout.txt",
    });
    expect(out).toContain("full output written to .clarvis/bash-stdout.txt");
    expect(out.endsWith("TAIL")).toBe(true);
    expect(out).not.toContain("HEAD");
    expect(out.startsWith("[... earlier output truncated")).toBe(true);
    expect(read(root, ".clarvis/bash-stdout.txt")).toBe(text);
    expect(read(root, ".clarvis/.gitignore")).toBe("*\n");
  });

  it("cuts the tail on a valid UTF-8 boundary (no broken multibyte char)", async () => {
    const text = "x".repeat(20) + "é".repeat(20);
    const out = await boundOrSpill(text, 15, {
      absPath: path.join(root, ".clarvis", "bash-stdout.txt"),
      displayPath: ".clarvis/bash-stdout.txt",
    });
    expect(out).not.toContain("�");
    expect(out.endsWith("é")).toBe(true);
    expect(read(root, ".clarvis/bash-stdout.txt")).toBe(text);
  });

  it("does not overwrite an existing .gitignore", async () => {
    const dir = path.join(root, ".clarvis");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, ".gitignore"), "custom\n");

    const text = "B".repeat(400);
    const out = await boundOrSpill(text, 40, {
      absPath: path.join(dir, "bash-stderr.txt"),
      displayPath: ".clarvis/bash-stderr.txt",
    });
    expect(out).toContain("full output written to .clarvis/bash-stderr.txt");
    expect(read(root, ".clarvis/.gitignore")).toBe("custom\n");
    expect(read(root, ".clarvis/bash-stderr.txt")).toBe(text);
  });

  it("falls back to the plain truncation marker when the spill write fails", async () => {
    const blocker = path.join(root, "blk");
    writeFileSync(blocker, "not a dir");

    const text = "C".repeat(300);
    const out = await boundOrSpill(text, 30, {
      absPath: path.join(blocker, "sub", "bash-stdout.txt"),
      displayPath: "blk/sub/bash-stdout.txt",
    });
    expect(out).toMatch(
      /^\[\.\.\. earlier output truncated: last \d+ of \d+ bytes shown \.\.\.\]\n/,
    );
    expect(out).not.toContain("full output written");
  });
});

describe("tool-level output bounding", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { maxOutputBytes: 100, maxBashOutputBytes: 100 });
  });
  afterEach(() => cleanup(root));

  it("truncates an oversized tool result with the marker", async () => {
    for (let i = 0; i < 30; i++) write(root, `file-with-a-fairly-long-name-${i}.txt`, "x");
    const r = await callTool("list_dir", { path: "." }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/\[\.\.\. output truncated: \d+ of \d+ bytes shown \.\.\.\]$/);
    expect(Buffer.byteLength(r.text, "utf8")).toBeLessThan(300);
  });

  it("bounds bash stdout per stream", async () => {
    const r = await callTool("bash", { command: "printf 'B%.0s' $(seq 1 5000)" }, config);
    expect(r.isError).toBe(false);
    expect(r.json.stdout).toContain("output truncated:");
  });
});
