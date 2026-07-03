import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  monitorDir,
  sidecarPath,
  logPath,
  exitPath,
  mintId,
  ensureClarvisDir,
  isAlive,
  killGroup,
  writeSidecar,
  readSidecar,
  listSidecars,
  readExitCode,
  readExitState,
  monitorRunning,
  removeMonitorFiles,
  sweepMonitors,
  type MonitorMeta,
} from "../../src/lib/monitor.js";
import { ToolError } from "../../src/errors.js";
import { makeWorkspace, cleanup } from "../helpers/fixtures.js";

const DEAD_PID = 2_147_480_000;

describe("monitor lib", () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup(root);
  });

  function meta(id: string, pid: number): MonitorMeta {
    return { id, command: "cmd", cwd: root, pid, startedAt: 1, readyWhen: null };
  }
  function putRaw(name: string, content: string): void {
    mkdirSync(monitorDir(root), { recursive: true });
    writeFileSync(path.join(monitorDir(root), name), content);
  }

  it("builds sidecar/log/exit paths under .clarvis", () => {
    expect(sidecarPath(root, "mon_x")).toBe(path.join(root, ".clarvis", "monitor-mon_x.json"));
    expect(logPath(root, "mon_x")).toBe(path.join(root, ".clarvis", "monitor-mon_x.log"));
    expect(exitPath(root, "mon_x")).toBe(path.join(root, ".clarvis", "monitor-mon_x.exit"));
  });

  it("mints ids of the form mon_<8 hex>", () => {
    expect(mintId()).toMatch(/^mon_[0-9a-f]{8}$/);
    expect(mintId()).not.toBe(mintId());
  });

  it("creates .clarvis with a self-ignoring .gitignore, idempotently", async () => {
    await ensureClarvisDir(root);
    await ensureClarvisDir(root);
    expect(readFileSync(path.join(root, ".clarvis", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("isAlive reports the current process alive and a bogus pid dead", () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(DEAD_PID)).toBe(false);
  });

  it("isAlive treats EPERM as alive", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      const e = new Error("eperm") as NodeJS.ErrnoException;
      e.code = "EPERM";
      throw e;
    });
    expect(isAlive(1234)).toBe(true);
  });

  it("isAlive treats ESRCH as dead", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      const e = new Error("esrch") as NodeJS.ErrnoException;
      e.code = "ESRCH";
      throw e;
    });
    expect(isAlive(1234)).toBe(false);
  });

  it("killGroup returns false when neither the group nor the pid can be signalled", () => {
    expect(killGroup(DEAD_PID, "SIGTERM")).toBe(false);
  });

  it("killGroup falls back to the bare pid when the group signal fails", () => {
    vi.spyOn(process, "kill").mockImplementation((pid: number) => {
      if (pid < 0) throw new Error("no group");
      return true;
    });
    expect(killGroup(4321, "SIGTERM")).toBe(true);
  });

  it("writes and reads back a sidecar", async () => {
    await writeSidecar(root, meta("mon_aa", 111));
    const back = await readSidecar(root, "mon_aa");
    expect(back.pid).toBe(111);
    expect(back.id).toBe("mon_aa");
  });

  it("readSidecar throws monitor_not_found for a missing, corrupt, or malformed sidecar", async () => {
    await expect(readSidecar(root, "mon_missing")).rejects.toMatchObject({
      code: "monitor_not_found",
    });
    putRaw("monitor-mon_bad.json", "{not json");
    await expect(readSidecar(root, "mon_bad")).rejects.toBeInstanceOf(ToolError);
    putRaw("monitor-mon_shape.json", JSON.stringify({ id: "mon_shape" }));
    await expect(readSidecar(root, "mon_shape")).rejects.toMatchObject({
      code: "monitor_not_found",
    });
  });

  it("listSidecars returns [] with no dir and skips non-monitor and corrupt files", async () => {
    expect(await listSidecars(root)).toEqual([]);
    await writeSidecar(root, meta("mon_ok", 222));
    putRaw("monitor-mon_corrupt.json", "nope");
    putRaw("monitor-mon_x.txt", JSON.stringify(meta("mon_x", 1)));
    putRaw("other.json", JSON.stringify(meta("other", 1)));
    const list = await listSidecars(root);
    expect(list.map((m) => m.id)).toEqual(["mon_ok"]);
  });

  it("readExitCode parses a valid code and yields null otherwise", async () => {
    mkdirSync(monitorDir(root), { recursive: true });
    expect(await readExitCode(root, "mon_none")).toBe(null);
    writeFileSync(exitPath(root, "mon_zero"), "0");
    expect(await readExitCode(root, "mon_zero")).toBe(0);
    writeFileSync(exitPath(root, "mon_n"), "137\n");
    expect(await readExitCode(root, "mon_n")).toBe(137);
    writeFileSync(exitPath(root, "mon_bad"), "oops");
    expect(await readExitCode(root, "mon_bad")).toBe(null);
    writeFileSync(exitPath(root, "mon_huge"), "99999999999999999999");
    expect(await readExitCode(root, "mon_huge")).toBe(null);
  });

  it("readExitState reports presence of the sentinel alongside the parsed code", async () => {
    mkdirSync(monitorDir(root), { recursive: true });
    expect(await readExitState(root, "mon_none")).toEqual({ exited: false, code: null });
    writeFileSync(exitPath(root, "mon_zero"), "0");
    expect(await readExitState(root, "mon_zero")).toEqual({ exited: true, code: 0 });
    writeFileSync(exitPath(root, "mon_bad"), "oops");
    expect(await readExitState(root, "mon_bad")).toEqual({ exited: true, code: null });
  });

  it("monitorRunning trusts the exit sentinel over a live (reused) pid", async () => {
    await writeSidecar(root, meta("mon_run", process.pid));
    expect(await monitorRunning(root, meta("mon_run", process.pid))).toBe(true);
    writeFileSync(exitPath(root, "mon_run"), "0");
    expect(await monitorRunning(root, meta("mon_run", process.pid))).toBe(false);
    expect(await monitorRunning(root, meta("mon_dead", DEAD_PID))).toBe(false);
  });

  it("sweepMonitors reaps a naturally-exited monitor even when its pid was reused", async () => {
    await writeSidecar(root, meta("mon_reused", process.pid));
    writeFileSync(logPath(root, "mon_reused"), "x");
    writeFileSync(exitPath(root, "mon_reused"), "0");
    await sweepMonitors(root);
    expect(existsSync(sidecarPath(root, "mon_reused"))).toBe(false);
    expect(existsSync(exitPath(root, "mon_reused"))).toBe(false);
  });

  it("removeMonitorFiles deletes all three sidecars", async () => {
    await writeSidecar(root, meta("mon_rm", 1));
    writeFileSync(logPath(root, "mon_rm"), "log");
    writeFileSync(exitPath(root, "mon_rm"), "0");
    await removeMonitorFiles(root, "mon_rm");
    expect(existsSync(sidecarPath(root, "mon_rm"))).toBe(false);
    expect(existsSync(logPath(root, "mon_rm"))).toBe(false);
    expect(existsSync(exitPath(root, "mon_rm"))).toBe(false);
  });

  it("sweepMonitors removes dead monitors and keeps live ones", async () => {
    await writeSidecar(root, meta("mon_dead", DEAD_PID));
    writeFileSync(logPath(root, "mon_dead"), "x");
    await writeSidecar(root, meta("mon_live", process.pid));
    await sweepMonitors(root);
    expect(existsSync(sidecarPath(root, "mon_dead"))).toBe(false);
    expect(existsSync(logPath(root, "mon_dead"))).toBe(false);
    expect(existsSync(sidecarPath(root, "mon_live"))).toBe(true);
  });
});
