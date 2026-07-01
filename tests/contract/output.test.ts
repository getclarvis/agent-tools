import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, cleanup, makeConfig, callTool, write } from "../helpers/fixtures.js";
import { bound } from "../../src/lib/output.js";
import type { ServerConfig } from "../../src/config.js";

describe("bound() multibyte safety (TEST-03)", () => {
  it("never splits a multibyte character at the cut boundary", () => {
    for (const ch of ["😀", "中"]) {
      const out = bound(ch.repeat(50), 10);
      expect(out).not.toContain("�");
      const shown = out.split("\n[...")[0]!;
      expect(Buffer.from(shown, "utf8").toString("utf8")).toBe(shown);
    }
  });
});

describe("output bounding", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { maxOutputBytes: 100 });
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
