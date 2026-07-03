import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyEdit } from "../../src/tools/edit-file.js";
import { multiEdit } from "../../src/tools/multi-edit.js";
import { ToolError } from "../../src/errors.js";
import { makeWorkspace, cleanup, makeConfig, write, read } from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

function toolError(fn: () => unknown): ToolError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ToolError) return e;
    throw e;
  }
  throw new Error("expected applyEdit to throw a ToolError");
}

describe("applyEdit uncovered branches", () => {
  it("guards the empty needle in countOccurrences and diagnoseNoMatch (edit-file 40, 61)", () => {
    const e = toolError(() => applyEdit("hello world", { old_string: "", new_string: "x" }));
    expect(e.code).toBe("no_match");
  });

  it("reports a single whitespace-differing line in the singular (edit-file 79)", () => {
    const e = toolError(() =>
      applyEdit("foo\n", { old_string: "  foo", new_string: "X", replace_all: true }),
    );
    expect(e.code).toBe("no_match");
    expect(e.message).toContain("line 1 but");
  });

  it("pluralizes several whitespace-differing lines without an ellipsis (edit-file 79)", () => {
    const e = toolError(() =>
      applyEdit("foo\nfoo\nfoo\n", { old_string: "  foo", new_string: "X", replace_all: true }),
    );
    expect(e.code).toBe("no_match");
    expect(e.message).toContain("lines 1, 2, 3 but");
    expect(e.message).not.toContain("…");
  });

  it("caps the whitespace-differing line list with an ellipsis past five (edit-file 79)", () => {
    const e = toolError(() =>
      applyEdit("foo\nfoo\nfoo\nfoo\nfoo\nfoo\nfoo\n", {
        old_string: "  foo",
        new_string: "X",
        replace_all: true,
      }),
    );
    expect(e.code).toBe("no_match");
    expect(e.message).toContain("lines 1, 2, 3, 4, 5, …");
  });

  it("lists the ambiguous occurrence lines without an ellipsis for a small count (edit-file 132-133)", () => {
    const e = toolError(() => applyEdit("x\nx\n", { old_string: "x", new_string: "y" }));
    expect(e.code).toBe("ambiguous_match");
    expect(e.message).toContain("at lines 1, 2)");
    expect(e.message).not.toContain("…");
  });

  it("caps the ambiguous occurrence list with an ellipsis when count exceeds 20 (edit-file 132-133)", () => {
    const text = Array.from({ length: 21 }, () => "x").join("\n");
    const e = toolError(() => applyEdit(text, { old_string: "x", new_string: "y" }));
    expect(e.code).toBe("ambiguous_match");
    expect(e.message).toContain("21 times");
    expect(e.message).toContain(", …)");
  });
});

describe("multi_edit uncovered branches", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root);
  });
  afterEach(() => cleanup(root));

  it("re-throws a non-ToolError from a malformed edit spec (multi-edit 86)", async () => {
    write(root, "f.txt", "hello world");
    await expect(multiEdit.handler({ path: "f.txt", edits: [null] }, config)).rejects.toThrow(
      TypeError,
    );
  });

  it("skips an undefined edit slot via the continue guard (multi-edit 74)", async () => {
    write(root, "f.txt", "hello world");
    const msg = await multiEdit.handler({ path: "f.txt", edits: [undefined] }, config);
    expect(msg).toContain("Applied 1 edit to");
    expect(read(root, "f.txt")).toBe("hello world");
  });

  it("continues past an undefined slot yet still applies a later real edit (multi-edit 74)", async () => {
    write(root, "f.txt", "alpha beta");
    const msg = await multiEdit.handler(
      { path: "f.txt", edits: [undefined, { old_string: "beta", new_string: "gamma" }] },
      config,
    );
    expect(msg).toContain("Applied 2 edits to");
    expect(read(root, "f.txt")).toBe("alpha gamma");
  });
});
