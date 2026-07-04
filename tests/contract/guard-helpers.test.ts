import { describe, expect, it } from "vitest";
import { withinWorkspace, touchesOutside, commandsIn } from "../../src/guard/helpers.js";
import { analyzeBash } from "../../src/guard/analyze-bash.js";
import { makeConfig } from "../helpers/fixtures.js";
import type { BashFacts, GuardContext, PathFact } from "../../src/guard/types.js";

const cfg = makeConfig("/ws");
const pf = (withinWorkspace: boolean): PathFact => ({ raw: "x", resolved: "/x", withinWorkspace });
const ctx = (paths: PathFact[], bash?: BashFacts): GuardContext => ({
  tool: "t",
  args: {},
  config: cfg,
  paths,
  bash,
});

describe("withinWorkspace", () => {
  it("is true only when there are paths and all are within", () => {
    expect(withinWorkspace(ctx([pf(true), pf(true)]))).toBe(true);
    expect(withinWorkspace(ctx([pf(true), pf(false)]))).toBe(false);
    expect(withinWorkspace(ctx([]))).toBe(false);
  });

  it("is false when the bash command is undecidable, even if known paths are within", () => {
    expect(withinWorkspace(ctx([pf(true)], analyzeBash("echo $(whoami)")))).toBe(false);
  });
});

describe("touchesOutside", () => {
  it("is true when any known path escapes", () => {
    expect(touchesOutside(ctx([pf(true), pf(false)]))).toBe(true);
    expect(touchesOutside(ctx([pf(true)]))).toBe(false);
    expect(touchesOutside(ctx([]))).toBe(false);
  });
});

describe("commandsIn", () => {
  it("matches exact and prefix, requiring every segment", () => {
    expect(commandsIn(analyzeBash("ls -la"), ["ls"])).toBe(true);
    expect(commandsIn(analyzeBash("git status"), ["git", "ls"])).toBe(true);
    expect(commandsIn(analyzeBash("cat a.txt"), ["ls"])).toBe(false);
    expect(commandsIn(analyzeBash("ls; whoami"), ["ls"])).toBe(false);
  });

  it("is fail-closed on undecidable, empty command, and empty allow entries", () => {
    expect(commandsIn(analyzeBash("echo $(x)"), ["echo"])).toBe(false);
    expect(commandsIn(analyzeBash(""), ["ls"])).toBe(false);
    expect(commandsIn(analyzeBash("ls"), ["", "  "])).toBe(false);
  });
});
