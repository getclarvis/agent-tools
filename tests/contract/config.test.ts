import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildConfig, StartupError } from "../../src/config.js";
import { makeWorkspace, cleanup } from "../helpers/fixtures.js";

describe("config / read-only resolution", () => {
  let root: string;
  const noProbe = () => false;

  beforeEach(() => {
    root = makeWorkspace();
  });
  afterEach(() => cleanup(root));

  it("defaults to the full surface (readOnly false)", () => {
    const cfg = buildConfig(["--workspace", root], {}, noProbe);
    expect(cfg.readOnly).toBe(false);
  });

  it("--read-only selects the read-only surface", () => {
    const cfg = buildConfig(["--workspace", root, "--read-only"], {}, noProbe);
    expect(cfg.readOnly).toBe(true);
  });

  it("READ_ONLY env enables read-only (truthy values, case/space-insensitive)", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on", " On "]) {
      const cfg = buildConfig(["--workspace", root], { READ_ONLY: v }, noProbe);
      expect(cfg.readOnly, `value ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it("READ_ONLY env disables read-only (falsy values)", () => {
    for (const v of ["0", "false", "no", "off", ""]) {
      const cfg = buildConfig(["--workspace", root], { READ_ONLY: v }, noProbe);
      expect(cfg.readOnly, `value ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("the --read-only flag wins over a falsy READ_ONLY (flag precedence)", () => {
    const cfg = buildConfig(["--workspace", root, "--read-only"], { READ_ONLY: "false" }, noProbe);
    expect(cfg.readOnly).toBe(true);
  });

  it("an unrecognized READ_ONLY value is a StartupError", () => {
    expect(() => buildConfig(["--workspace", root], { READ_ONLY: "maybe" }, noProbe)).toThrow(
      StartupError,
    );
  });

  it("confines to the workspace by default", () => {
    const cfg = buildConfig(["--workspace", root], {}, noProbe);
    expect(cfg.confineToWorkspace).toBe(true);
  });

  it("ALLOW_OUTSIDE_WORKSPACE env disables confinement (truthy values)", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on", " On "]) {
      const cfg = buildConfig(["--workspace", root], { ALLOW_OUTSIDE_WORKSPACE: v }, noProbe);
      expect(cfg.confineToWorkspace, `value ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("--allow-outside-workspace flag disables confinement", () => {
    const cfg = buildConfig(["--workspace", root, "--allow-outside-workspace"], {}, noProbe);
    expect(cfg.confineToWorkspace).toBe(false);
  });

  it("an unrecognized ALLOW_OUTSIDE_WORKSPACE value is a StartupError", () => {
    expect(() =>
      buildConfig(["--workspace", root], { ALLOW_OUTSIDE_WORKSPACE: "maybe" }, noProbe),
    ).toThrow(StartupError);
  });

  it("--workspace without a value is a StartupError (CFG-01)", () => {
    expect(() => buildConfig(["--workspace"], {}, noProbe)).toThrow(StartupError);
    expect(() => buildConfig(["--workspace", "--read-only"], {}, noProbe)).toThrow(StartupError);
  });

  it("rejects loose numeric forms for MAX_OUTPUT_BYTES (CFG-02)", () => {
    for (const v of ["0x10", "1e21", " 100 ", "12.5", "-5"]) {
      expect(() => buildConfig(["--workspace", root], { MAX_OUTPUT_BYTES: v }, noProbe)).toThrow(
        StartupError,
      );
    }
  });

  it("enforces a floor for MAX_OUTPUT_BYTES (CFG-02)", () => {
    expect(() => buildConfig(["--workspace", root], { MAX_OUTPUT_BYTES: "1" }, noProbe)).toThrow(
      StartupError,
    );
    const cfg = buildConfig(["--workspace", root], { MAX_OUTPUT_BYTES: "4096" }, noProbe);
    expect(cfg.maxOutputBytes).toBe(4096);
  });

  it("defaults bash timeout and its ceiling (120000 / 600000)", () => {
    const cfg = buildConfig(["--workspace", root], {}, noProbe);
    expect(cfg.bashTimeoutMs).toBe(120000);
    expect(cfg.bashTimeoutMaxMs).toBe(600000);
  });

  it("parses BASH_TIMEOUT_MAX_MS independently of the default", () => {
    const cfg = buildConfig(
      ["--workspace", root],
      { BASH_TIMEOUT_MS: "5000", BASH_TIMEOUT_MAX_MS: "900000" },
      noProbe,
    );
    expect(cfg.bashTimeoutMs).toBe(5000);
    expect(cfg.bashTimeoutMaxMs).toBe(900000);
  });

  it("rejects a ceiling below the default (BASH_TIMEOUT_MAX_MS < BASH_TIMEOUT_MS)", () => {
    expect(() =>
      buildConfig(
        ["--workspace", root],
        { BASH_TIMEOUT_MS: "900000", BASH_TIMEOUT_MAX_MS: "600000" },
        noProbe,
      ),
    ).toThrow(StartupError);
  });
});
