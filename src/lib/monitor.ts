import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ToolError } from "../errors.js";
import { writeAtomic } from "./atomic.js";

export interface MonitorMeta {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  startedAt: number;
  readyWhen: string | null;
}

export function monitorDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".clarvis");
}

export function sidecarPath(workspaceRoot: string, id: string): string {
  return path.join(monitorDir(workspaceRoot), `monitor-${id}.json`);
}

export function logPath(workspaceRoot: string, id: string): string {
  return path.join(monitorDir(workspaceRoot), `monitor-${id}.log`);
}

export function exitPath(workspaceRoot: string, id: string): string {
  return path.join(monitorDir(workspaceRoot), `monitor-${id}.exit`);
}

export function mintId(): string {
  return `mon_${randomBytes(4).toString("hex")}`;
}

export async function ensureClarvisDir(workspaceRoot: string): Promise<string> {
  const dir = monitorDir(workspaceRoot);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, ".gitignore"), "*\n", { flag: "wx" }).catch(() => {});
  return dir;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function killGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

function isMeta(m: unknown): m is MonitorMeta {
  return (
    typeof m === "object" &&
    m !== null &&
    typeof (m as MonitorMeta).id === "string" &&
    typeof (m as MonitorMeta).pid === "number"
  );
}

export async function writeSidecar(workspaceRoot: string, meta: MonitorMeta): Promise<void> {
  await writeAtomic(sidecarPath(workspaceRoot, meta.id), JSON.stringify(meta));
}

export async function readSidecar(workspaceRoot: string, id: string): Promise<MonitorMeta> {
  let raw: string;
  try {
    raw = await fs.readFile(sidecarPath(workspaceRoot, id), "utf8");
  } catch {
    throw new ToolError("monitor_not_found", `No such monitor: ${id}`, { id });
  }
  try {
    const m: unknown = JSON.parse(raw);
    if (isMeta(m)) return m;
  } catch {
    /* fall through to not_found */
  }
  throw new ToolError("monitor_not_found", `No such monitor: ${id}`, { id });
}

export async function listSidecars(workspaceRoot: string): Promise<MonitorMeta[]> {
  const dir = monitorDir(workspaceRoot);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const metas: MonitorMeta[] = [];
  for (const name of entries) {
    if (!name.startsWith("monitor-") || !name.endsWith(".json")) continue;
    try {
      const m: unknown = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
      if (isMeta(m)) metas.push(m);
    } catch {
      continue;
    }
  }
  return metas;
}

export interface ExitState {
  exited: boolean;
  code: number | null;
}

export async function readExitState(workspaceRoot: string, id: string): Promise<ExitState> {
  let raw: string;
  try {
    raw = (await fs.readFile(exitPath(workspaceRoot, id), "utf8")).trim();
  } catch {
    return { exited: false, code: null };
  }
  if (!/^-?\d+$/.test(raw)) return { exited: true, code: null };
  const n = Number(raw);
  return { exited: true, code: Number.isSafeInteger(n) ? n : null };
}

export async function readExitCode(workspaceRoot: string, id: string): Promise<number | null> {
  return (await readExitState(workspaceRoot, id)).code;
}

export async function monitorRunning(workspaceRoot: string, meta: MonitorMeta): Promise<boolean> {
  const { exited } = await readExitState(workspaceRoot, meta.id);
  if (exited) return false;
  return isAlive(meta.pid);
}

export async function removeMonitorFiles(workspaceRoot: string, id: string): Promise<void> {
  await Promise.all([
    fs.rm(sidecarPath(workspaceRoot, id), { force: true }),
    fs.rm(logPath(workspaceRoot, id), { force: true }),
    fs.rm(exitPath(workspaceRoot, id), { force: true }),
  ]);
}

export async function sweepMonitors(workspaceRoot: string): Promise<void> {
  const metas = await listSidecars(workspaceRoot);
  await Promise.all(
    metas.map(async (m) => {
      if (!(await monitorRunning(workspaceRoot, m))) await removeMonitorFiles(workspaceRoot, m.id);
    }),
  );
}
