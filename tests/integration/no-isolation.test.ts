import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeWorkspace, cleanup, makeConfig, callTool } from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("workspace confinement (default) and opt-out", () => {
  let root: string;
  let outside: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    outside = mkdtempSync(path.join(tmpdir(), "clarvis-outside-"));
    config = makeConfig(root);
  });
  afterEach(() => {
    cleanup(root);
    rmSync(outside, { recursive: true, force: true });
  });

  it("rejects an absolute path outside the workspace root with path_escape", async () => {
    const target = path.join(outside, "external.txt");
    writeFileSync(target, "external content\n");
    const r = await callTool("read_file", { path: target }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("path_escape");
  });

  it("rejects a .. path above the workspace root with path_escape", async () => {
    writeFileSync(path.join(outside, "up.txt"), "up\n");
    const rel = path.relative(root, path.join(outside, "up.txt"));
    const r = await callTool("read_file", { path: rel }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("path_escape");
  });

  it("reads an absolute path outside the workspace root when confinement is disabled", async () => {
    const target = path.join(outside, "external.txt");
    writeFileSync(target, "external content\n");
    const r = await callTool(
      "read_file",
      { path: target },
      makeConfig(root, { confineToWorkspace: false }),
    );
    expect(r.isError).toBe(false);
    expect(r.text).toContain("external content");
  });

  it("rejects a symlink inside the workspace that points outside", async () => {
    const secret = path.join(outside, "secret.txt");
    writeFileSync(secret, "secret\n");
    const r1 = await callTool(
      "bash",
      { command: `ln -s ${secret} ${path.join(root, "leak")}` },
      makeConfig(root, { confineToWorkspace: false }),
    );
    expect(r1.json.exit_code).toBe(0);
    const r2 = await callTool("read_file", { path: "leak" }, config);
    expect(r2.isError).toBe(true);
    expect(r2.json.error).toBe("path_escape");
  });

  it("runs an arbitrary shell command (no command filtering)", async () => {
    const r = await callTool("bash", { command: "echo unconfined" }, config);
    expect(r.json.exit_code).toBe(0);
    expect(r.json.stdout).toBe("unconfined\n");
  });
});
