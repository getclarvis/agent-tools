import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listTools, dispatch } from "../../src/core.js";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  write,
  resultText,
} from "../helpers/fixtures.js";

const SYNTAX_TOOLS = ["outline", "check_syntax"];

describe("surface without tree-sitter", () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
  });
  afterEach(() => cleanup(root));

  it("hides outline and check_syntax from the full surface", () => {
    const names = listTools(makeConfig(root)).map((t) => t.name);
    for (const tool of SYNTAX_TOOLS) expect(names, tool).not.toContain(tool);
    expect(names).toHaveLength(23);
  });

  it("hides them from the read-only surface too", () => {
    const names = listTools(makeConfig(root, { readOnly: true })).map((t) => t.name);
    for (const tool of SYNTAX_TOOLS) expect(names, tool).not.toContain(tool);
    expect(names).toHaveLength(9);
  });

  it("dispatching them is indistinguishable from an unknown tool", async () => {
    const config = makeConfig(root);
    write(root, "a.ts", "const x = 1;\n");
    const bogus = await dispatch("does_not_exist", {}, config);
    const bogusErr = JSON.parse(resultText(bogus.content)) as { error: string };
    expect(bogusErr.error).toBe("not_found");
    for (const tool of SYNTAX_TOOLS) {
      const r = await dispatch(tool, { path: "a.ts" }, config);
      expect(r.isError, tool).toBe(true);
      const err = JSON.parse(resultText(r.content)) as { error: string };
      expect(err.error, tool).toBe(bogusErr.error);
    }
  });

  it("write results carry no syntax warning even for broken code", async () => {
    const config = makeConfig(root);
    const r = await callTool(
      "write_file",
      { path: "broken.ts", content: "const x = = 1;\n" },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).not.toContain("warning:");
  });

  it("exposes both tools on both surfaces when tree-sitter is available", () => {
    const full = listTools(makeConfig(root, { treeSitterAvailable: true })).map((t) => t.name);
    const ro = listTools(makeConfig(root, { readOnly: true, treeSitterAvailable: true })).map(
      (t) => t.name,
    );
    for (const tool of SYNTAX_TOOLS) {
      expect(full, tool).toContain(tool);
      expect(ro, tool).toContain(tool);
    }
    expect(full).toHaveLength(25);
    expect(ro).toHaveLength(11);
  });
});
