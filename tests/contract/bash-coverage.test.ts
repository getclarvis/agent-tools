import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync } from "node:fs";
import { constants as osConstants } from "node:os";
import path from "node:path";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  chmod,
  isRoot,
} from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

interface OutputModuleShape {
  boundOrSpill: (
    text: string,
    maxBytes: number,
    spill: { absPath: string; displayPath: string },
  ) => Promise<string>;
  [key: string]: unknown;
}

vi.mock("../../src/lib/output.js", async (importOriginal) => {
  const actual = (await importOriginal()) as OutputModuleShape;
  return {
    ...actual,
    boundOrSpill: async (
      text: string,
      maxBytes: number,
      spill: { absPath: string; displayPath: string },
    ): Promise<string> => {
      if (text.includes("__FAIL_FINALIZE__")) {
        throw new Error("boom finalize");
      }
      return actual.boundOrSpill(text, maxBytes, spill);
    },
  };
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const NUL_COMMAND = "echo " + String.fromCharCode(0) + " hi";

describe("bash coverage — hard branches", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("rejects io_error when spawn throws synchronously (null byte in command) [117-118]", async () => {
    const r = await callTool("bash", { command: NUL_COMMAND }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("io_error");
    expect(String(r.json.message)).toContain("Failed to spawn command");
  });

  it("rejects io_error when finalizing captured output fails [234]", async () => {
    const r = await callTool("bash", { command: "echo __FAIL_FINALIZE__" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("io_error");
    expect(String(r.json.message)).toContain("Failed to finalize output");
  });

  it("uses the child.kill fallback when the process group is already gone [134]", async () => {
    const ac = new AbortController();
    const p = callTool(
      "bash",
      { command: "setsid sleep 1 & echo hi", timeout_ms: 60000 },
      config,
      ac.signal,
    );
    await sleep(50);
    ac.abort();
    const r = await p;
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("aborted");
  });

  it("resolves with the raw exit code when the command exits nonzero [computeExit 32; resolve 223-231]", async () => {
    const r = await callTool("bash", { command: "printf out; printf err 1>&2; exit 3" }, config);
    expect(r.isError).toBe(false);
    expect(r.json.exit_code).toBe(3);
    expect(r.json.stdout).toBe("out");
    expect(r.json.stderr).toBe("err");
    expect(r.json.signal).toBeNull();
    expect(r.json.timed_out).toBe(false);
  });

  it("derives exit code 128+signum when the child is killed by a signal [computeExit 33-34]", async () => {
    const r = await callTool("bash", { command: "kill -TERM $$" }, config);
    expect(r.isError).toBe(false);
    expect(r.json.exit_code).toBe(128 + osConstants.signals.SIGTERM);
    expect(r.json.signal).toBe("SIGTERM");
    expect(r.json.timed_out).toBe(false);
  });

  it("rejects timeout and kills the process group when the deadline fires [timer 164-165; 201-210]", async () => {
    const r = await callTool("bash", { command: "sleep 30", timeout_ms: 200 }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("timeout");
    expect(r.json.timeout_ms).toBe(200);
  });

  it("rejects output_limit when a single stream floods past the capture cap [onData 150-154; 212-221]", async () => {
    const r = await callTool("bash", { command: "yes CLARVIS_FLOOD | head -c 9000000" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("output_limit");
    expect(r.json.max_capture_bytes).toBe(8 * 1024 * 1024);
  });

  describe.skipIf(isRoot)("non-root only", () => {
    it("rejects io_error when the child emits an async spawn error (unsearchable cwd) [239-240]", async () => {
      mkdirSync(path.join(root, "noexec"));
      chmod(root, "noexec", 0o000);
      try {
        const r = await callTool("bash", { command: "pwd", cwd: "noexec" }, config);
        expect(r.isError).toBe(true);
        expect(r.json.error).toBe("io_error");
        expect(String(r.json.message)).toContain("Failed to run command");
      } finally {
        chmod(root, "noexec", 0o755);
      }
    });

    it("skips process.kill in killGroup when the aborted child never received a pid [132-else]", async () => {
      mkdirSync(path.join(root, "noexec2"));
      chmod(root, "noexec2", 0o000);
      const ac = new AbortController();
      ac.abort();
      try {
        const r = await callTool("bash", { command: "pwd", cwd: "noexec2" }, config, ac.signal);
        expect(r.isError).toBe(true);
        expect(["io_error", "aborted"]).toContain(r.json.error);
      } finally {
        chmod(root, "noexec2", 0o755);
      }
    });
  });
});
