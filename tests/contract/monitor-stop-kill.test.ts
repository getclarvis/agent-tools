import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWorkspace, cleanup, makeConfig, callTool } from "../helpers/fixtures.js";
import { monitorDir, sidecarPath, killGroup } from "../../src/lib/monitor.js";
import type { ServerConfig } from "../../src/config.js";

vi.mock(import("../../src/lib/monitor.js"), async (orig) => {
  const actual = await orig();
  return { ...actual, killGroup: vi.fn(() => true) };
});

describe("monitor_stop SIGKILL escalation", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
    vi.mocked(killGroup).mockClear();
  });
  afterEach(() => cleanup(root));

  it("escalates SIGTERM then SIGKILL when the process outlives the grace", async () => {
    mkdirSync(monitorDir(root), { recursive: true });
    const meta = {
      id: "mon_live",
      command: "x",
      cwd: root,
      pid: process.pid,
      startedAt: 1,
      readyWhen: null,
    };
    writeFileSync(sidecarPath(root, "mon_live"), JSON.stringify(meta));

    const r = await callTool("monitor_stop", { id: "mon_live" }, config);
    expect(r.json.stopped).toBe(true);
    expect(existsSync(sidecarPath(root, "mon_live"))).toBe(false);
    expect(vi.mocked(killGroup)).toHaveBeenNthCalledWith(1, process.pid, "SIGTERM");
    expect(vi.mocked(killGroup)).toHaveBeenNthCalledWith(2, process.pid, "SIGKILL");
  });
});
