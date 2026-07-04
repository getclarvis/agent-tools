import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tools } from "../../src/tools/registry.js";
import { dispatch, listTools } from "../../src/core.js";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  write,
  resultText,
} from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("core / registry", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("exposes exactly the twenty-five fixed tools", () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "apply_patch",
        "bash",
        "check_syntax",
        "copy",
        "diff",
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
        "read_files",
        "read_image",
        "remove",
        "replace",
        "tree",
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
    expect(JSON.parse(resultText(r.content))).toMatchObject({ error: "not_found" });
  });
});

describe("dispatch — input validation", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("returns invalid_input when a required arg is missing (no throw)", async () => {
    const r = await callTool("read_file", {}, config);
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: "invalid_input" });
    expect(typeof r.json.message).toBe("string");
    expect((r.json.message as string).length).toBeGreaterThan(0);
  });

  it("returns invalid_input with a detail message when an arg is wrong-typed", async () => {
    const r = await dispatch("read_file", { path: 123 }, config);
    expect(r.isError).toBe(true);
    const json = JSON.parse(resultText(r.content)) as Record<string, unknown>;
    expect(json.error).toBe("invalid_input");
    expect(json.message).not.toBe("invalid arguments");
  });

  it("rejects an unknown argument as invalid_input", async () => {
    const r = await dispatch("read_file", { path: "a.txt", bogus: true }, config);
    expect(r.isError).toBe(true);
    expect(JSON.parse(resultText(r.content))).toMatchObject({ error: "invalid_input" });
  });
});

describe("dispatch — success and error routing", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("returns a bounded tool's handler output verbatim on success", async () => {
    write(root, "hello.txt", "line one\nline two\n");
    const r = await dispatch("read_file", { path: "hello.txt" }, config);
    expect(r.isError).toBe(false);
    expect(resultText(r.content)).toContain("line one");
    expect(resultText(r.content)).toContain("line two");
  });

  it("routes an unbounded tool's output through the byte-bounder on success", async () => {
    write(root, "a.txt", "x");
    const r = await dispatch("list_dir", {}, config);
    expect(r.isError).toBe(false);
    expect(resultText(r.content)).toContain("a.txt");
  });

  it("catches a handler error thrown at runtime and serializes it", async () => {
    const r = await dispatch("read_file", { path: "does-not-exist.txt" }, config);
    expect(r.isError).toBe(true);
    expect(JSON.parse(resultText(r.content))).toMatchObject({ error: "not_found" });
  });
});

describe("listTools surface", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("returns the full surface with schemas", () => {
    const infos = listTools(config);
    expect(infos.length).toBeGreaterThan(0);
    for (const info of infos) {
      expect(typeof info.name).toBe("string");
      expect(typeof info.description).toBe("string");
      expect(info.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("honours the read-only surface", () => {
    const ro = listTools(makeConfig(root, { readOnly: true }));
    const names = ro.map((t) => t.name).sort();
    expect(names).toEqual([
      "diff",
      "file_stat",
      "glob",
      "grep",
      "list_dir",
      "read_file",
      "read_files",
      "read_image",
      "tree",
    ]);
  });

  it("the read-only surface includes the syntax tools when tree-sitter is available", () => {
    const ro = listTools(makeConfig(root, { readOnly: true, treeSitterAvailable: true }));
    const names = ro.map((t) => t.name).sort();
    expect(names).toEqual([
      "check_syntax",
      "diff",
      "file_stat",
      "glob",
      "grep",
      "list_dir",
      "outline",
      "read_file",
      "read_files",
      "read_image",
      "tree",
    ]);
  });
});
