import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWorkspace, cleanup, makeConfig, callTool } from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

const state = vi.hoisted(() => ({ mode: "real" as "real" | "throw" | "nopid" }));

vi.mock(import("node:child_process"), async (importOriginal) => {
  const actual = await importOriginal();
  const realSpawn = actual.spawn as unknown as (...a: unknown[]) => unknown;
  const spawn = ((...args: unknown[]) => {
    if (state.mode === "throw") throw new Error("spawn boom");
    if (state.mode === "nopid") {
      return {
        pid: undefined,
        on(event: string, cb: (e: Error) => void) {
          if (event === "error") cb(new Error("spawn error event"));
        },
        unref() {},
      };
    }
    return realSpawn(...args);
  }) as unknown as typeof actual.spawn;
  return { ...actual, spawn };
});

describe("monitor spawn failures", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
    state.mode = "real";
  });
  afterEach(() => {
    state.mode = "real";
    cleanup(root);
  });

  it("returns io_error and cleans up the log when spawn throws", async () => {
    state.mode = "throw";
    const r = await callTool("monitor_start", { command: "true" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("io_error");
    const clarvis = path.join(root, ".clarvis");
    const leftover = existsSync(clarvis)
      ? (await import("node:fs")).readdirSync(clarvis).filter((n) => n.startsWith("monitor-"))
      : [];
    expect(leftover).toEqual([]);
  });

  it("returns io_error when the spawned child has no pid", async () => {
    state.mode = "nopid";
    const r = await callTool("monitor_start", { command: "true" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("io_error");
  });
});
