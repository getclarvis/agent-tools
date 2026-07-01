import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tools } from "../../src/tools/registry.js";
import { dispatch } from "../../src/core.js";
import { makeWorkspace, cleanup, makeConfig } from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("core / registry", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("exposes exactly the nine fixed tools", () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "apply_patch",
        "bash",
        "edit_file",
        "glob",
        "grep",
        "list_dir",
        "multi_edit",
        "read_file",
        "write_file",
      ].sort(),
    );
  });

  it("every tool input schema sets additionalProperties: false", () => {
    for (const t of tools) {
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("an unknown tool name returns a not_found tool error (no throw)", async () => {
    const r = await dispatch("does_not_exist", {}, config);
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ error: "not_found" });
  });
});
