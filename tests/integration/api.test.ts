import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentTools } from "../../src/index.js";
import { makeWorkspace, cleanup, write } from "../helpers/fixtures.js";

const FULL = [
  "apply_patch",
  "bash",
  "edit_file",
  "glob",
  "grep",
  "list_dir",
  "multi_edit",
  "read_file",
  "write_file",
];

describe("createAgentTools (library API)", () => {
  let root: string;
  beforeEach(() => {
    root = makeWorkspace();
  });
  afterEach(() => cleanup(root));

  it("lists the nine tools and exposes the resolved config", () => {
    const t = createAgentTools({ workspaceRoot: root, probeRipgrep: () => false });
    expect(t.config.workspaceRoot).toBe(root);
    expect(t.config.ripgrepAvailable).toBe(false);
    expect(
      t
        .listTools()
        .map((x) => x.name)
        .sort(),
    ).toEqual([...FULL].sort());
  });

  it("round-trips read_file / grep / bash", async () => {
    const t = createAgentTools({ workspaceRoot: root, probeRipgrep: () => false });
    write(root, "a.txt", "alpha\nbeta\n");

    const r = await t.callTool("read_file", { path: "a.txt" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("alpha");

    const g = await t.callTool("grep", { pattern: "beta" });
    expect(g.isError).toBe(false);
    expect(g.text).toContain("a.txt");

    const b = await t.callTool("bash", { command: "echo hi" });
    expect(b.isError).toBe(false);
    expect(JSON.parse(b.text)).toMatchObject({ exit_code: 0 });
  });

  it("read-only mode hides mutating tools and blocks writes", async () => {
    const t = createAgentTools({ workspaceRoot: root, readOnly: true, probeRipgrep: () => false });
    expect(
      t
        .listTools()
        .map((x) => x.name)
        .sort(),
    ).toEqual(["glob", "grep", "list_dir", "read_file"]);

    const w = await t.callTool("write_file", { path: "x.txt", content: "nope" });
    expect(w.isError).toBe(true);
    expect(JSON.parse(w.text)).toMatchObject({ error: "not_found" });
  });

  it("returns a not_found tool error for an unknown tool", async () => {
    const t = createAgentTools({ workspaceRoot: root, probeRipgrep: () => false });
    const r = await t.callTool("does_not_exist", {});
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ error: "not_found" });
  });

  it("defaults callTool args to an empty object", async () => {
    const t = createAgentTools({ workspaceRoot: root, probeRipgrep: () => false });
    const r = await t.callTool("list_dir");
    expect(r.isError).toBe(false);
  });
});
