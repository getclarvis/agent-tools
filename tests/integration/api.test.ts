import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentTools } from "../../src/index.js";
import { makeWorkspace, cleanup, write, resultText } from "../helpers/fixtures.js";

const FULL = [
  "apply_patch",
  "bash",
  "check_syntax",
  "copy",
  "edit_file",
  "file_stat",
  "glob",
  "grep",
  "list_dir",
  "mkdir",
  "monitor_list",
  "monitor_poll",
  "monitor_start",
  "monitor_stop",
  "move",
  "multi_edit",
  "outline",
  "read_file",
  "read_image",
  "remove",
  "tree",
  "write_file",
];

describe("createAgentTools (library API)", () => {
  let root: string;
  beforeEach(() => {
    root = makeWorkspace();
  });
  afterEach(() => cleanup(root));

  it("lists the twenty-two tools and exposes the resolved config", () => {
    const t = createAgentTools({
      workspaceRoot: root,
      probeRipgrep: () => false,
      probeTreeSitter: () => true,
    });
    expect(t.config.workspaceRoot).toBe(root);
    expect(t.config.ripgrepAvailable).toBe(false);
    expect(t.config.treeSitterAvailable).toBe(true);
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
    expect(resultText(r.content)).toContain("alpha");

    const g = await t.callTool("grep", { pattern: "beta" });
    expect(g.isError).toBe(false);
    expect(resultText(g.content)).toContain("a.txt");

    const b = await t.callTool("bash", { command: "echo hi" });
    expect(b.isError).toBe(false);
    expect(JSON.parse(resultText(b.content))).toMatchObject({ exit_code: 0 });
  });

  it("read-only mode hides mutating tools and blocks writes", async () => {
    const t = createAgentTools({
      workspaceRoot: root,
      readOnly: true,
      probeRipgrep: () => false,
      probeTreeSitter: () => false,
    });
    expect(
      t
        .listTools()
        .map((x) => x.name)
        .sort(),
    ).toEqual(["file_stat", "glob", "grep", "list_dir", "read_file", "read_image", "tree"]);

    const w = await t.callTool("write_file", { path: "x.txt", content: "nope" });
    expect(w.isError).toBe(true);
    expect(JSON.parse(resultText(w.content))).toMatchObject({ error: "not_found" });
  });

  it("returns a not_found tool error for an unknown tool", async () => {
    const t = createAgentTools({ workspaceRoot: root, probeRipgrep: () => false });
    const r = await t.callTool("does_not_exist", {});
    expect(r.isError).toBe(true);
    expect(JSON.parse(resultText(r.content))).toMatchObject({ error: "not_found" });
  });

  it("defaults callTool args to an empty object", async () => {
    const t = createAgentTools({ workspaceRoot: root, probeRipgrep: () => false });
    const r = await t.callTool("list_dir");
    expect(r.isError).toBe(false);
  });

  it("does not mutate the caller's args object with schema defaults", async () => {
    const t = createAgentTools({ workspaceRoot: root, probeRipgrep: () => false });
    write(root, "a.txt", "alpha\n");
    const args = { pattern: "alpha" };
    const r = await t.callTool("grep", args);
    expect(r.isError).toBe(false);
    expect(Object.keys(args)).toEqual(["pattern"]);
  });

  it("accepts a frozen args object (defaults injected into a copy)", async () => {
    const t = createAgentTools({ workspaceRoot: root, probeRipgrep: () => false });
    write(root, "a.txt", "alpha\n");
    const r = await t.callTool("grep", Object.freeze({ pattern: "alpha" }));
    expect(r.isError).toBe(false);
    expect(resultText(r.content)).toContain("a.txt");
  });
});
