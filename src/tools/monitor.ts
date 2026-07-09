import { spawn } from "node:child_process";
import { openSync, closeSync, promises as fs } from "node:fs";
import { ToolError } from "../errors.js";
import { resolvePath } from "../lib/paths.js";
import { statDirectory } from "../lib/files.js";
import { readLogSlice } from "../lib/logslice.js";
import {
  type MonitorMeta,
  ensureClarvisDir,
  exitPath,
  isAlive,
  killGroup,
  listSidecars,
  logPath,
  mintId,
  monitorRunning,
  readExitState,
  readSidecar,
  removeMonitorFiles,
  writeSidecar,
} from "../lib/monitor.js";
import type { ServerConfig } from "../config.js";
import type { ToolDef } from "./types.js";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const READY_POLL_MS = 75;
const STOP_GRACE_MS = 400;

function compileRegex(pattern: string, field: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (err) {
    throw new ToolError("invalid_input", `Invalid ${field} regex: ${(err as Error).message}`, {
      [field]: pattern,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface ReadyResult {
  ready: boolean;
  running: boolean;
  output: string;
  nextOffset: number;
}

async function waitForReady(
  config: ServerConfig,
  id: string,
  pid: number,
  re: RegExp,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ReadyResult> {
  const lp = logPath(config.workspaceRoot, id);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const slice = await readLogSlice(lp, 0, config.maxOutputBytes);
    if (re.test(slice.text)) {
      return {
        ready: true,
        running: isAlive(pid),
        output: slice.text,
        nextOffset: slice.nextOffset,
      };
    }
    if (!isAlive(pid)) {
      return { ready: false, running: false, output: slice.text, nextOffset: slice.nextOffset };
    }
    if (signal?.aborted || Date.now() >= deadline) {
      return { ready: false, running: true, output: slice.text, nextOffset: slice.nextOffset };
    }
    await delay(READY_POLL_MS);
  }
}

export const monitorStart: ToolDef = {
  name: "monitor_start",
  description:
    "Start a long-lived command in the BACKGROUND and return a monitor id immediately — unlike " +
    "bash, which blocks until the command exits. Use it for a dev server, file watcher, `tail -f`, " +
    "or anything that keeps producing output over time. Read incremental output with monitor_poll " +
    "and stop it with monitor_stop. If `ready_when` (a regex) is given, blocks until the output " +
    "matches it (or `ready_timeout_ms` elapses) before returning. Do NOT background inside the " +
    "command (no trailing `&`) — the monitor backgrounds it for you, and a trailing `&` makes the " +
    "id track the wrong process.",
  bounded: true,
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "Shell command run via `sh -c`, in the background. stdin is closed. Its stdout and " +
          "stderr are combined into one log you read with monitor_poll.",
      },
      cwd: { type: "string", description: "Working directory. Default: workspace root." },
      ready_when: {
        type: "string",
        description:
          "Optional regex. When set, monitor_start blocks until the combined output matches it " +
          '(e.g. "listening on"), then returns with ready:true. Times out per ready_timeout_ms. ' +
          "Matched against the first MAX_OUTPUT_BYTES of output.",
      },
      ready_timeout_ms: {
        type: "integer",
        minimum: 0,
        description:
          "Max time to wait for ready_when, in ms. Default: MONITOR_READY_TIMEOUT_MS (30000). " +
          "Ignored unless ready_when is set.",
      },
    },
    required: ["command"],
  },
  async handler(args, config, signal) {
    const command = args.command as string;
    const cwdArg = args.cwd as string | undefined;
    const cwd = cwdArg
      ? resolvePath(cwdArg, config.workspaceRoot, config.confineToWorkspace)
      : config.workspaceRoot;
    await statDirectory(cwd, cwdArg ?? cwd);

    const readyWhen = args.ready_when as string | undefined;
    const readyRe = readyWhen === undefined ? undefined : compileRegex(readyWhen, "ready_when");
    const readyTimeoutMs = Math.min(
      (args.ready_timeout_ms as number | undefined) || config.monitorReadyTimeoutMs,
      MAX_TIMER_DELAY_MS,
    );

    const liveness = await Promise.all(
      (await listSidecars(config.workspaceRoot)).map((m) =>
        monitorRunning(config.workspaceRoot, m),
      ),
    );
    const aliveCount = liveness.filter(Boolean).length;
    if (aliveCount >= config.maxMonitors) {
      throw new ToolError(
        "too_many_monitors",
        `Too many live monitors (${aliveCount}/${config.maxMonitors}); stop some with monitor_stop first`,
        { limit: config.maxMonitors },
      );
    }

    const id = mintId();
    await ensureClarvisDir(config.workspaceRoot);
    const lp = logPath(config.workspaceRoot, id);
    const ep = exitPath(config.workspaceRoot, id);
    const wrapped = `trap 'printf "%s" "$?" > "$MON_EXIT"' EXIT\n${command}\n`;

    const fd = openSync(lp, "a");
    let child;
    try {
      child = spawn("sh", ["-c", wrapped], {
        cwd,
        env: { ...process.env, MON_EXIT: ep },
        stdio: ["ignore", fd, fd],
        detached: true,
      });
    } catch (err) {
      closeSync(fd);
      await fs.rm(lp, { force: true });
      throw new ToolError("io_error", `Failed to spawn monitor: ${(err as Error).message}`);
    }
    closeSync(fd);
    child.on("error", () => {});
    if (child.pid === undefined) {
      await fs.rm(lp, { force: true });
      throw new ToolError("io_error", "Failed to spawn monitor: process has no pid");
    }
    child.unref();

    const meta: MonitorMeta = {
      id,
      command,
      cwd,
      pid: child.pid,
      startedAt: Date.now(),
      readyWhen: readyWhen ?? null,
    };
    await writeSidecar(config.workspaceRoot, meta);

    if (readyRe) {
      const r = await waitForReady(config, id, child.pid, readyRe, readyTimeoutMs, signal);
      return JSON.stringify({
        id,
        running: r.running,
        ready: r.ready,
        output: r.output,
        next_offset: r.nextOffset,
      });
    }
    return JSON.stringify({ id, running: true, ready: null, output: "", next_offset: 0 });
  },
};

export const monitorPoll: ToolDef = {
  name: "monitor_poll",
  description:
    "Read new output from a monitor since a byte offset. Returns { running, output, next_offset, " +
    "exit_code }: pass next_offset back on the next call to page forward. `match` (a regex) keeps " +
    "only matching lines. exit_code is set only after a natural exit — it is null while running, " +
    "and null if the monitor was stopped or killed.",
  bounded: true,
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Monitor id returned by monitor_start." },
      offset: {
        type: "integer",
        minimum: 0,
        description:
          "Byte offset to read from. Use the next_offset from the previous poll. Default 0.",
      },
      match: {
        type: "string",
        description: "Optional regex; only lines matching it are returned.",
      },
    },
    required: ["id"],
  },
  async handler(args, config) {
    const id = args.id as string;
    const offset = (args.offset as number | undefined) ?? 0;
    const matchStr = args.match as string | undefined;

    const meta = await readSidecar(config.workspaceRoot, id);
    const exitState = await readExitState(config.workspaceRoot, id);
    const running = !exitState.exited && isAlive(meta.pid);
    const slice = await readLogSlice(
      logPath(config.workspaceRoot, id),
      offset,
      config.maxOutputBytes,
    );

    let output = slice.text;
    let nextOffset = slice.nextOffset;

    if (!slice.more && running && output.includes("\n") && !output.endsWith("\n")) {
      const lastNl = output.lastIndexOf("\n");
      const held = output.slice(lastNl + 1);
      nextOffset -= Buffer.byteLength(held, "utf8");
      output = output.slice(0, lastNl + 1);
    }

    if (matchStr !== undefined) {
      const re = compileRegex(matchStr, "match");
      const body = output.endsWith("\n") ? output.slice(0, -1) : output;
      const lines = body.length > 0 ? body.split("\n") : [];
      output = lines.filter((l) => re.test(l)).join("\n");
    }

    if (slice.more) {
      output += `\n[... more output buffered; continue with offset=${nextOffset} ...]`;
    }

    const exitCode = exitState.exited ? exitState.code : null;
    return JSON.stringify({ running, output, next_offset: nextOffset, exit_code: exitCode });
  },
};

export const monitorStop: ToolDef = {
  name: "monitor_stop",
  description:
    "Stop a monitor: signal its whole process group (SIGTERM, then SIGKILL after a short grace) " +
    "and remove its files. Idempotent — stopping an already-exited monitor just cleans up.",
  bounded: true,
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Monitor id returned by monitor_start." },
    },
    required: ["id"],
  },
  async handler(args, config) {
    const id = args.id as string;
    const meta = await readSidecar(config.workspaceRoot, id);
    const { exited } = await readExitState(config.workspaceRoot, id);
    if (!exited && isAlive(meta.pid)) {
      killGroup(meta.pid, "SIGTERM");
      await delay(STOP_GRACE_MS);
      if (isAlive(meta.pid)) killGroup(meta.pid, "SIGKILL");
    }
    await removeMonitorFiles(config.workspaceRoot, id);
    return JSON.stringify({ stopped: true, id });
  },
};

export const monitorList: ToolDef = {
  name: "monitor_list",
  description:
    "List all monitors (running and finished) with their id, command, running flag, start time, " +
    "and cwd. Use it to find and stop leaked monitors.",
  bounded: true,
  inputSchema: {
    type: "object",
    properties: {},
  },
  async handler(args, config) {
    const metas = await listSidecars(config.workspaceRoot);
    const monitors = await Promise.all(
      metas.map(async (m) => ({
        id: m.id,
        command: m.command,
        running: await monitorRunning(config.workspaceRoot, m),
        started_at: m.startedAt,
        cwd: m.cwd,
      })),
    );
    monitors.sort((a, b) => b.started_at - a.started_at);
    return JSON.stringify({ monitors });
  },
};
