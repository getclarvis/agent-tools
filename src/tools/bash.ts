import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";
import path from "node:path";
import { ToolError } from "../errors.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import { statDirectory } from "../lib/files.js";
import { boundOrSpill, allocateBudget } from "../lib/output.js";
import { uniqueToken } from "../lib/token.js";
import type { ServerConfig } from "../config.js";
import type { ToolDef } from "./types.js";

const MAX_CAPTURE_FLOOR = 8 * 1024 * 1024;
const STDIO_DRAIN_MS = 100;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface Sink {
  text: string;
  bytes: number;
  capped: boolean;
}

function spillTarget(
  config: ServerConfig,
  stream: "stdout" | "stderr",
): { absPath: string; displayPath: string } {
  const name = `bash-${uniqueToken()}.${stream}.log`;
  const absPath = path.join(config.workspaceRoot, ".clarvis", name);
  return { absPath, displayPath: displayPath(absPath, config.workspaceRoot) };
}

function computeExit(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  const sigNum = signal ? (osConstants.signals[signal] ?? 0) : 0;
  return signal ? 128 + sigNum : 0;
}

async function finalizeOutput(
  config: ServerConfig,
  outText: string,
  errText: string,
): Promise<{ stdout: string; stderr: string }> {
  const [outBudget, errBudget] = allocateBudget(
    Buffer.byteLength(outText, "utf8"),
    Buffer.byteLength(errText, "utf8"),
    config.maxOutputBytes,
  );
  const [stdout, stderr] = await Promise.all([
    boundOrSpill(outText, outBudget, spillTarget(config, "stdout")),
    boundOrSpill(errText, errBudget, spillTarget(config, "stderr")),
  ]);
  return { stdout, stderr };
}

export const bash: ToolDef = {
  name: "bash",
  description:
    "Run a shell command (sh -c) and return stdout, stderr, and exit code. The command runs to " +
    "completion and BLOCKS until it exits, so a long-lived process (a dev server, file watcher, " +
    "`npm run dev`, `npm start`) MUST be started in the BACKGROUND with its output redirected — e.g. " +
    "`npm start > /tmp/server.log 2>&1 &` — and then verified separately (sleep + curl the port, or " +
    "read the log). A server left in the foreground will block until the timeout and waste the call.",
  bounded: true,
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "Shell command, run via the system shell (sh -c). stdin is closed (no interactive " +
          "prompts). A long-lived process MUST be backgrounded with output redirected (e.g. " +
          "cmd > /tmp/out.log 2>&1 &) or it blocks until timeout.",
      },
      cwd: { type: "string", description: "Working directory. Default: workspace root." },
      timeout_ms: {
        type: "integer",
        minimum: 1,
        description:
          "Max run time in ms. Default: BASH_TIMEOUT_MS (120000); may be raised up to " +
          "BASH_TIMEOUT_MAX_MS (600000) for a long build/test/install. On timeout the process " +
          "group is killed and a timeout error is returned.",
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const command = args.command as string;
    const cwdArg = args.cwd as string | undefined;
    const cwd = cwdArg
      ? resolvePath(cwdArg, config.workspaceRoot, config.confineToWorkspace)
      : config.workspaceRoot;
    const requestedTimeoutMs = (args.timeout_ms as number | undefined) ?? config.bashTimeoutMs;
    const timeoutMs = Math.min(requestedTimeoutMs, config.bashTimeoutMaxMs, MAX_TIMER_DELAY_MS);

    await statDirectory(cwd, cwdArg ?? cwd);

    return runCommand(command, cwd, timeoutMs, config);
  },
};

function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  config: ServerConfig,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("sh", ["-c", command], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    } catch (err) {
      reject(new ToolError("io_error", `Failed to spawn command: ${(err as Error).message}`));
      return;
    }

    const captureCap = Math.max(config.maxOutputBytes, MAX_CAPTURE_FLOOR);
    const stdoutSink: Sink = { text: "", bytes: 0, capped: false };
    const stderrSink: Sink = { text: "", bytes: 0, capped: false };
    let timedOut = false;
    let outputLimited = false;
    let settled = false;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;

    const killGroup = (): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };

    const onData =
      (sink: Sink) =>
      (d: string): void => {
        if (sink.capped) return;
        sink.text += d;
        sink.bytes += Buffer.byteLength(d, "utf8");
        if (sink.bytes > captureCap) {
          sink.capped = true;
          if (!outputLimited) {
            outputLimited = true;
            killGroup();
          }
        }
      };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", onData(stdoutSink));
    child.stderr.on("data", onData(stderrSink));

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);

    const teardown = (): void => {
      child.stdout?.removeAllListeners("data");
      child.stderr?.removeAllListeners("data");
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    };

    const beginSettle = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      if (drainTimer) clearTimeout(drainTimer);
      teardown();
      return true;
    };

    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (!beginSettle()) return;

      void finalizeOutput(config, stdoutSink.text, stderrSink.text).then(
        ({ stdout, stderr }) => {
          if (timedOut) {
            reject(
              new ToolError("timeout", `Command exceeded ${timeoutMs}ms`, {
                timeout_ms: timeoutMs,
                stdout,
                stderr,
              }),
            );
            return;
          }

          if (outputLimited) {
            reject(
              new ToolError(
                "output_limit",
                `Command output exceeded ${captureCap} bytes on a single stream and was killed`,
                { max_capture_bytes: captureCap, stdout, stderr },
              ),
            );
            return;
          }

          resolve(
            JSON.stringify({
              exit_code: computeExit(code, signal),
              stdout,
              stderr,
              signal: signal ?? null,
              timed_out: false,
            }),
          );
        },
        (err) =>
          reject(new ToolError("io_error", `Failed to finalize output: ${(err as Error).message}`)),
      );
    };

    child.on("error", (err) => {
      if (!beginSettle()) return;
      reject(new ToolError("io_error", `Failed to run command: ${err.message}`));
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);

      if (drainTimer) clearTimeout(drainTimer);
      drainTimer = setTimeout(() => finish(code, signal), STDIO_DRAIN_MS);
    });

    child.on("close", (code, signal) => finish(code, signal));
  });
}
