import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { makeWorkspace, cleanup, makeConfig, callTool } from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("bash", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("captures stdout and exit code", async () => {
    const r = await callTool("bash", { command: "echo hello" }, config);
    expect(r.isError).toBe(false);
    expect(r.json.exit_code).toBe(0);
    expect(r.json.stdout).toBe("hello\n");
    expect(r.json.timed_out).toBe(false);
  });

  it("a non-zero exit is a normal result, not a tool error", async () => {
    const r = await callTool("bash", { command: "exit 3" }, config);
    expect(r.isError).toBe(false);
    expect(r.json.exit_code).toBe(3);
  });

  it("captures stderr separately", async () => {
    const r = await callTool("bash", { command: "echo oops 1>&2" }, config);
    expect(r.json.stderr).toBe("oops\n");
    expect(r.json.stdout).toBe("");
  });

  it("returns a timeout error when the command exceeds its limit", async () => {
    const r = await callTool("bash", { command: "sleep 5", timeout_ms: 100 }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("timeout");
    expect(r.json.timeout_ms).toBe(100);
  });

  it("aborting the signal kills a long-running command and returns an aborted error", async () => {
    const ac = new AbortController();
    const p = callTool("bash", { command: "sleep 30", timeout_ms: 60000 }, config, ac.signal);
    await new Promise((r) => setTimeout(r, 100));
    ac.abort();
    const r = await p;
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("aborted");
  });

  it("an already-aborted signal returns an aborted error without hanging", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await callTool("bash", { command: "sleep 30", timeout_ms: 60000 }, config, ac.signal);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("aborted");
  });

  it("clamps an overflowing timeout_ms instead of firing immediately (finding 1.2)", async () => {
    const r = await callTool("bash", { command: "echo hi", timeout_ms: 3_000_000_000 }, config);
    expect(r.isError).toBe(false);
    expect(r.json.exit_code).toBe(0);
    expect(r.json.stdout).toBe("hi\n");
  });

  it("caps timeout_ms at the configured bashTimeoutMaxMs ceiling (finding 1.2)", async () => {
    const capped = makeConfig(root, { bashTimeoutMs: 150, bashTimeoutMaxMs: 150 });
    const r = await callTool("bash", { command: "sleep 5", timeout_ms: 60000 }, capped);
    expect(r.json.error).toBe("timeout");
    expect(r.json.timeout_ms).toBe(150);
  });

  it("allows timeout_ms above the default up to the ceiling (decoupled ceiling)", async () => {
    const cfg = makeConfig(root, { bashTimeoutMs: 150, bashTimeoutMaxMs: 10000 });
    const r = await callTool("bash", { command: "sleep 0.4; echo done", timeout_ms: 5000 }, cfg);
    expect(r.isError).toBe(false);
    expect(r.json.exit_code).toBe(0);
    expect(r.json.stdout).toContain("done");
  });

  it("uses bashTimeoutMs as the default when timeout_ms is omitted", async () => {
    const cfg = makeConfig(root, { bashTimeoutMs: 150, bashTimeoutMaxMs: 10000 });
    const r = await callTool("bash", { command: "sleep 5" }, cfg);
    expect(r.json.error).toBe("timeout");
    expect(r.json.timeout_ms).toBe(150);
  });

  it("does not hang on a backgrounded process — settles on the shell's exit", async () => {
    const start = Date.now();
    const r = await callTool("bash", { command: "sleep 10 & echo ready" }, config);
    const elapsed = Date.now() - start;
    expect(r.isError).toBe(false);
    expect(r.json.exit_code).toBe(0);
    expect(r.json.stdout).toContain("ready");
    expect(r.json.timed_out).toBe(false);
    expect(elapsed).toBeLessThan(2000);
  });

  it("spills overflowing stdout to a workspace file and points the footer at it", async () => {
    const small = makeConfig(root, { maxOutputBytes: 64 });
    const r = await callTool(
      "bash",
      { command: "for i in $(seq 1 200); do echo line$i; done" },
      small,
    );
    expect(r.isError).toBe(false);
    const stdout = r.json.stdout as string;
    expect(stdout).toContain("output truncated");
    expect(stdout).toContain("full output written to");

    const m = stdout.match(/full output written to (\S+) \.\.\.\]/);
    expect(m).not.toBeNull();
    const rel = m![1]!;
    const full = readFileSync(path.join(root, rel), "utf8");
    expect(full).toContain("line1\n");
    expect(full).toContain("line200\n");
    expect(Buffer.byteLength(full, "utf8")).toBeGreaterThan(64);
  });

  it("errors not_found for a missing cwd", async () => {
    const r = await callTool("bash", { command: "pwd", cwd: "no_such_dir" }, config);
    expect(r.json.error).toBe("not_found");
  });

  it("errors not_a_file when cwd is an existing file", async () => {
    const r = await callTool("bash", { command: "echo > afile" }, config);
    expect(r.isError).toBe(false);
    const r2 = await callTool("bash", { command: "pwd", cwd: "afile" }, config);
    expect(r2.json.error).toBe("not_a_file");
  });

  it("reports a signal-killed command as a non-zero exit, never success", async () => {
    const r = await callTool("bash", { command: "kill -9 $$" }, config);
    expect(r.isError).toBe(false);
    expect(r.json.exit_code).toBe(137);
    expect(r.json.signal).toBe("SIGKILL");
  });

  it("reports signal: null for a normal exit", async () => {
    const r = await callTool("bash", { command: "echo ok" }, config);
    expect(r.json.signal).toBeNull();
  });

  it("rejects out-of-schema input with invalid_input", async () => {
    const r = await callTool("bash", { command: "echo x", bogus: 1 }, config);
    expect(r.json.error).toBe("invalid_input");
  });

  it("kills a runaway producer at the capture ceiling instead of growing unbounded", async () => {
    const start = Date.now();
    const r = await callTool("bash", { command: "yes", timeout_ms: 60000 }, config);
    const elapsed = Date.now() - start;
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("output_limit");
    expect(elapsed).toBeLessThan(30000);
    expect(typeof r.json.stdout).toBe("string");
  }, 60000);

  it("kills a backgrounded grandchild when the command times out (group kill, TEST-04)", async () => {
    const r = await callTool(
      "bash",
      { command: "sleep 1 && echo leaked > leak.txt & sleep 10", timeout_ms: 300 },
      config,
    );
    expect(r.json.error).toBe("timeout");
    await new Promise((res) => setTimeout(res, 1500));
    expect(existsSync(path.join(root, "leak.txt"))).toBe(false);
  }, 10000);

  it("budgets stdout and stderr against a shared cap (not 1x each)", async () => {
    const small = makeConfig(root, { maxOutputBytes: 2000 });
    const r = await callTool(
      "bash",
      { command: "for i in $(seq 1 500); do echo out$i; echo err$i 1>&2; done" },
      small,
    );
    expect(r.isError).toBe(false);
    const out = r.json.stdout as string;
    const err = r.json.stderr as string;
    expect(out).toContain("output truncated:");
    expect(err).toContain("output truncated:");
    const combined = Buffer.byteLength(out, "utf8") + Buffer.byteLength(err, "utf8");
    expect(combined).toBeLessThan(2000 + 600);
  });
});
