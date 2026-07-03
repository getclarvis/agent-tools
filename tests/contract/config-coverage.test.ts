import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConfig, resolveConfig, StartupError } from "../../src/config.js";
import { makeWorkspace, cleanup, write } from "../helpers/fixtures.js";

const state = vi.hoisted(() => ({ throwOnSpawn: false }));

vi.mock(import("node:child_process"), async (importOriginal) => {
  const actual = await importOriginal();
  const realSpawnSync = actual.spawnSync as unknown as (...a: unknown[]) => {
    status: number | null;
  };
  const spawnSync = ((...args: unknown[]) => {
    if (state.throwOnSpawn) throw new Error("spawnSync boom");
    return realSpawnSync(...args);
  }) as unknown as typeof actual.spawnSync;
  return { ...actual, spawnSync };
});

const noProbe = () => false;

describe("config coverage — parseWorkspaceArg --workspace= form (43-49)", () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
    state.throwOnSpawn = false;
  });
  afterEach(() => cleanup(root));

  it("accepts the --workspace=<path> inline form (43-46)", () => {
    const cfg = buildConfig([`--workspace=${root}`], {}, noProbe);
    expect(cfg.workspaceRoot).toBe(root);
  });

  it("rejects an empty --workspace= inline form (45)", () => {
    expect(() => buildConfig(["--workspace="], {}, noProbe)).toThrow(StartupError);
  });

  it("skips a non-matching arg and falls through to WORKSPACE_ROOT env", () => {
    const cfg = buildConfig(["--read-only"], { WORKSPACE_ROOT: root }, noProbe);
    expect(cfg.workspaceRoot).toBe(root);
    expect(cfg.readOnly).toBe(true);
  });

  it("returns undefined when no workspace arg is present, so buildConfig throws (49, 193)", () => {
    expect(() => buildConfig([], {}, noProbe)).toThrow(StartupError);
    expect(() => buildConfig([], {}, noProbe)).toThrow(
      "No workspace root: pass --workspace <path> or set WORKSPACE_ROOT.",
    );
  });
});

describe("config coverage — validateWorkspace (109, 112)", () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
    state.throwOnSpawn = false;
  });
  afterEach(() => cleanup(root));

  it("throws when the workspace root does not exist (109)", () => {
    expect(() => buildConfig(["--workspace", `${root}/does-not-exist`], {}, noProbe)).toThrow(
      /Workspace root does not exist/,
    );
  });

  it("throws when the workspace root is a file, not a directory (112)", () => {
    const filePath = write(root, "not-a-dir.txt", "x");
    expect(() => buildConfig(["--workspace", filePath], {}, noProbe)).toThrow(
      /Workspace root is not a directory/,
    );
  });
});

describe("config coverage — resolveConfig guards (119, 150)", () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
    state.throwOnSpawn = false;
  });
  afterEach(() => cleanup(root));

  it("throws when options.workspaceRoot is empty (150)", () => {
    expect(() => resolveConfig({ workspaceRoot: "" })).toThrow(
      "No workspace root: options.workspaceRoot is required.",
    );
  });

  it("requireMin rejects a value below the minimum (119, n < min arm)", () => {
    expect(() =>
      resolveConfig({ workspaceRoot: root, maxOutputBytes: 100, probeRipgrep: noProbe }),
    ).toThrow(StartupError);
  });

  it("requireMin rejects a non-safe integer (119, !isSafeInteger arm)", () => {
    expect(() =>
      resolveConfig({
        workspaceRoot: root,
        bashTimeoutMs: Number.MAX_SAFE_INTEGER + 1,
        probeRipgrep: noProbe,
      }),
    ).toThrow(StartupError);
  });
});

describe("config coverage — probeRipgrep default (95-99)", () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
    state.throwOnSpawn = false;
  });
  afterEach(() => {
    state.throwOnSpawn = false;
    cleanup(root);
  });

  it("runs the real probe when no probe is supplied (95-97)", () => {
    const cfg = buildConfig(["--workspace", root], {});
    expect(typeof cfg.ripgrepAvailable).toBe("boolean");
  });

  it("returns false when the spawn throws (98-99 catch)", () => {
    state.throwOnSpawn = true;
    const cfg = buildConfig(["--workspace", root], {});
    expect(cfg.ripgrepAvailable).toBe(false);
  });
});

describe("config coverage — remaining branch arms (L35, L71, L180)", () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
    state.throwOnSpawn = false;
  });
  afterEach(() => {
    state.throwOnSpawn = false;
    cleanup(root);
  });

  it("skips an undefined argv element and still finds --workspace (35 continue)", () => {
    const argv: string[] = [undefined as unknown as string, "--workspace", root];
    const cfg = buildConfig(argv, {}, noProbe);
    expect(cfg.workspaceRoot).toBe(root);
  });

  it("confines when ALLOW_OUTSIDE_WORKSPACE is a false value (71 return true)", () => {
    const cfg = buildConfig(["--workspace", root], { ALLOW_OUTSIDE_WORKSPACE: "0" }, noProbe);
    expect(cfg.confineToWorkspace).toBe(true);
  });

  it("also confines for the empty-string false value (71 return true)", () => {
    const cfg = buildConfig(["--workspace", root], { ALLOW_OUTSIDE_WORKSPACE: "" }, noProbe);
    expect(cfg.confineToWorkspace).toBe(true);
  });

  it("falls back to the real probeRipgrep when options.probeRipgrep is omitted (180 ?? arm)", () => {
    const cfg = resolveConfig({ workspaceRoot: root });
    expect(typeof cfg.ripgrepAvailable).toBe("boolean");
  });
});
