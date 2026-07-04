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

describe("config", () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
    state.throwOnSpawn = false;
  });
  afterEach(() => {
    state.throwOnSpawn = false;
    cleanup(root);
  });

  describe("read-only resolution", () => {
    it("defaults to the full read-write surface", () => {
      const cfg = buildConfig(["--workspace", root], {}, noProbe);
      expect(cfg.readOnly).toBe(false);
    });

    it("--read-only selects the read-only surface", () => {
      const cfg = buildConfig(["--workspace", root, "--read-only"], {}, noProbe);
      expect(cfg.readOnly).toBe(true);
    });

    it("treats truthy READ_ONLY values as read-only, ignoring case and surrounding space", () => {
      for (const v of ["1", "true", "TRUE", "yes", "on", " On "]) {
        const cfg = buildConfig(["--workspace", root], { READ_ONLY: v }, noProbe);
        expect(cfg.readOnly, `value ${JSON.stringify(v)}`).toBe(true);
      }
    });

    it("treats falsy READ_ONLY values as read-write", () => {
      for (const v of ["0", "false", "no", "off", ""]) {
        const cfg = buildConfig(["--workspace", root], { READ_ONLY: v }, noProbe);
        expect(cfg.readOnly, `value ${JSON.stringify(v)}`).toBe(false);
      }
    });

    it("lets the --read-only flag win over a falsy READ_ONLY value", () => {
      const cfg = buildConfig(
        ["--workspace", root, "--read-only"],
        { READ_ONLY: "false" },
        noProbe,
      );
      expect(cfg.readOnly).toBe(true);
    });

    it("rejects an unrecognized READ_ONLY value", () => {
      expect(() => buildConfig(["--workspace", root], { READ_ONLY: "maybe" }, noProbe)).toThrow(
        StartupError,
      );
    });
  });

  describe("workspace confinement", () => {
    it("confines to the workspace by default", () => {
      const cfg = buildConfig(["--workspace", root], {}, noProbe);
      expect(cfg.confineToWorkspace).toBe(true);
    });

    it("disables confinement for truthy ALLOW_OUTSIDE_WORKSPACE values", () => {
      for (const v of ["1", "true", "TRUE", "yes", "on", " On "]) {
        const cfg = buildConfig(["--workspace", root], { ALLOW_OUTSIDE_WORKSPACE: v }, noProbe);
        expect(cfg.confineToWorkspace, `value ${JSON.stringify(v)}`).toBe(false);
      }
    });

    it("disables confinement with the --allow-outside-workspace flag", () => {
      const cfg = buildConfig(["--workspace", root, "--allow-outside-workspace"], {}, noProbe);
      expect(cfg.confineToWorkspace).toBe(false);
    });

    it("keeps confinement for a falsy ALLOW_OUTSIDE_WORKSPACE value", () => {
      const cfg = buildConfig(["--workspace", root], { ALLOW_OUTSIDE_WORKSPACE: "0" }, noProbe);
      expect(cfg.confineToWorkspace).toBe(true);
    });

    it("keeps confinement for an empty ALLOW_OUTSIDE_WORKSPACE value", () => {
      const cfg = buildConfig(["--workspace", root], { ALLOW_OUTSIDE_WORKSPACE: "" }, noProbe);
      expect(cfg.confineToWorkspace).toBe(true);
    });

    it("rejects an unrecognized ALLOW_OUTSIDE_WORKSPACE value", () => {
      expect(() =>
        buildConfig(["--workspace", root], { ALLOW_OUTSIDE_WORKSPACE: "maybe" }, noProbe),
      ).toThrow(StartupError);
    });
  });

  describe("workspace argument parsing", () => {
    it("resolves the workspace root from --workspace <path>", () => {
      const cfg = buildConfig(["--workspace", root], {}, noProbe);
      expect(cfg.workspaceRoot).toBe(root);
    });

    it("resolves the workspace root from the --workspace=<path> inline form", () => {
      const cfg = buildConfig([`--workspace=${root}`], {}, noProbe);
      expect(cfg.workspaceRoot).toBe(root);
    });

    it("rejects an empty --workspace= inline form", () => {
      expect(() => buildConfig(["--workspace="], {}, noProbe)).toThrow(StartupError);
    });

    it("rejects --workspace without a following path", () => {
      expect(() => buildConfig(["--workspace"], {}, noProbe)).toThrow(StartupError);
      expect(() => buildConfig(["--workspace", "--read-only"], {}, noProbe)).toThrow(StartupError);
    });

    it("falls back to WORKSPACE_ROOT when no workspace flag is given", () => {
      const cfg = buildConfig(["--read-only"], { WORKSPACE_ROOT: root }, noProbe);
      expect(cfg.workspaceRoot).toBe(root);
      expect(cfg.readOnly).toBe(true);
    });

    it("skips an undefined argv element and still finds --workspace", () => {
      const argv: string[] = [undefined as unknown as string, "--workspace", root];
      const cfg = buildConfig(argv, {}, noProbe);
      expect(cfg.workspaceRoot).toBe(root);
    });

    it("throws with guidance when no workspace root is provided", () => {
      expect(() => buildConfig([], {}, noProbe)).toThrow(StartupError);
      expect(() => buildConfig([], {}, noProbe)).toThrow(
        "No workspace root: pass --workspace <path> or set WORKSPACE_ROOT.",
      );
    });
  });

  describe("workspace validation", () => {
    it("rejects a workspace root that does not exist", () => {
      expect(() => buildConfig(["--workspace", `${root}/does-not-exist`], {}, noProbe)).toThrow(
        /Workspace root does not exist/,
      );
    });

    it("rejects a workspace root that is a file rather than a directory", () => {
      const filePath = write(root, "not-a-dir.txt", "x");
      expect(() => buildConfig(["--workspace", filePath], {}, noProbe)).toThrow(
        /Workspace root is not a directory/,
      );
    });
  });

  describe("numeric and timeout limits", () => {
    it("rejects loose numeric forms for MAX_OUTPUT_BYTES", () => {
      for (const v of ["0x10", "1e21", " 100 ", "12.5", "-5"]) {
        expect(() => buildConfig(["--workspace", root], { MAX_OUTPUT_BYTES: v }, noProbe)).toThrow(
          StartupError,
        );
      }
    });

    it("enforces a minimum for MAX_OUTPUT_BYTES", () => {
      expect(() => buildConfig(["--workspace", root], { MAX_OUTPUT_BYTES: "1" }, noProbe)).toThrow(
        StartupError,
      );
      const cfg = buildConfig(["--workspace", root], { MAX_OUTPUT_BYTES: "4096" }, noProbe);
      expect(cfg.maxOutputBytes).toBe(4096);
    });

    it("defaults maxImageBytes and accepts a MAX_IMAGE_BYTES override", () => {
      const def = buildConfig(["--workspace", root], {}, noProbe);
      expect(def.maxImageBytes).toBe(5_000_000);
      const cfg = buildConfig(["--workspace", root], { MAX_IMAGE_BYTES: "1048576" }, noProbe);
      expect(cfg.maxImageBytes).toBe(1048576);
    });

    it("rejects a MAX_IMAGE_BYTES below the minimum", () => {
      expect(() => buildConfig(["--workspace", root], { MAX_IMAGE_BYTES: "1" }, noProbe)).toThrow(
        StartupError,
      );
    });

    it("defaults the bash timeout and its ceiling", () => {
      const cfg = buildConfig(["--workspace", root], {}, noProbe);
      expect(cfg.bashTimeoutMs).toBe(120000);
      expect(cfg.bashTimeoutMaxMs).toBe(600000);
    });

    it("parses BASH_TIMEOUT_MAX_MS independently of the timeout", () => {
      const cfg = buildConfig(
        ["--workspace", root],
        { BASH_TIMEOUT_MS: "5000", BASH_TIMEOUT_MAX_MS: "900000" },
        noProbe,
      );
      expect(cfg.bashTimeoutMs).toBe(5000);
      expect(cfg.bashTimeoutMaxMs).toBe(900000);
    });

    it("rejects a ceiling below the configured timeout", () => {
      expect(() =>
        buildConfig(
          ["--workspace", root],
          { BASH_TIMEOUT_MS: "900000", BASH_TIMEOUT_MAX_MS: "600000" },
          noProbe,
        ),
      ).toThrow(StartupError);
    });

    it("defaults the monitor readiness timeout and monitor cap", () => {
      const cfg = buildConfig(["--workspace", root], {}, noProbe);
      expect(cfg.monitorReadyTimeoutMs).toBe(30000);
      expect(cfg.maxMonitors).toBe(32);
    });

    it("parses MONITOR_READY_TIMEOUT_MS and MAX_MONITORS overrides", () => {
      const cfg = buildConfig(
        ["--workspace", root],
        { MONITOR_READY_TIMEOUT_MS: "5000", MAX_MONITORS: "4" },
        noProbe,
      );
      expect(cfg.monitorReadyTimeoutMs).toBe(5000);
      expect(cfg.maxMonitors).toBe(4);
    });

    it("rejects a non-positive MAX_MONITORS", () => {
      expect(() => buildConfig(["--workspace", root], { MAX_MONITORS: "0" }, noProbe)).toThrow(
        StartupError,
      );
    });
  });

  describe("resolveConfig (programmatic options)", () => {
    it("requires a non-empty workspaceRoot", () => {
      expect(() => resolveConfig({ workspaceRoot: "" })).toThrow(
        "No workspace root: options.workspaceRoot is required.",
      );
    });

    it("rejects a maxOutputBytes below the minimum", () => {
      expect(() =>
        resolveConfig({ workspaceRoot: root, maxOutputBytes: 100, probeRipgrep: noProbe }),
      ).toThrow(StartupError);
    });

    it("rejects a bashTimeoutMs that is not a safe integer", () => {
      expect(() =>
        resolveConfig({
          workspaceRoot: root,
          bashTimeoutMs: Number.MAX_SAFE_INTEGER + 1,
          probeRipgrep: noProbe,
        }),
      ).toThrow(StartupError);
    });

    it("rejects a maxMonitors below one", () => {
      expect(() =>
        resolveConfig({ workspaceRoot: root, maxMonitors: 0, probeRipgrep: noProbe }),
      ).toThrow(StartupError);
    });
  });

  describe("ripgrep probe", () => {
    it("probes for ripgrep by default", () => {
      const cfg = buildConfig(["--workspace", root], {});
      expect(typeof cfg.ripgrepAvailable).toBe("boolean");
    });

    it("reports ripgrep unavailable when the probe throws", () => {
      state.throwOnSpawn = true;
      const cfg = buildConfig(["--workspace", root], {});
      expect(cfg.ripgrepAvailable).toBe(false);
    });

    it("falls back to the real ripgrep probe when none is supplied", () => {
      const cfg = resolveConfig({ workspaceRoot: root });
      expect(typeof cfg.ripgrepAvailable).toBe("boolean");
    });
  });

  describe("tree-sitter probe", () => {
    it("probes for tree-sitter by default and finds the dev dependency", () => {
      const cfg = buildConfig(["--workspace", root], {}, noProbe);
      expect(cfg.treeSitterAvailable).toBe(true);
    });

    it("honours an injected tree-sitter probe", () => {
      const cfg = buildConfig(["--workspace", root], {}, noProbe, () => false);
      expect(cfg.treeSitterAvailable).toBe(false);
    });

    it("resolveConfig honours options.probeTreeSitter", () => {
      const cfg = resolveConfig({
        workspaceRoot: root,
        probeRipgrep: noProbe,
        probeTreeSitter: () => false,
      });
      expect(cfg.treeSitterAvailable).toBe(false);
    });
  });
});
