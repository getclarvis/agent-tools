import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { makeWorkspace, cleanup, write } from "../helpers/fixtures.js";
import { resolvePath, displayPath } from "../../src/lib/paths.js";

describe("resolvePath", () => {
  let root: string;
  beforeEach(() => {
    root = makeWorkspace();
  });
  afterEach(() => cleanup(root));

  it("resolves a relative path against an existing workspace with confine", () => {
    const result = resolvePath("nested/file.txt", root, true);
    expect(result).toBe(path.join(root, "nested", "file.txt"));
  });

  it("canonicalizes an existing confined target that has no missing path segments", () => {
    write(root, "here.txt", "x");
    const result = resolvePath("here.txt", root, true);
    expect(result).toBe(path.join(root, "here.txt"));
  });

  it("normalizes an absolute input and returns it unchanged", () => {
    const abs = path.join(root, "abs.txt");
    expect(resolvePath(abs, root, false)).toBe(abs);
  });

  it("resolves against a workspace root that does not exist yet", () => {
    const ghostRoot = path.join(root, "ghost", "sub");
    const result = resolvePath("file.txt", ghostRoot, true);
    expect(result).toBe(path.join(ghostRoot, "file.txt"));
  });

  it("throws when a confined path escapes the workspace root", () => {
    const outside = path.resolve(root, "..", "escapee.txt");
    expect(() => resolvePath(outside, root, true)).toThrow(/escapes the workspace root/);
  });
});

describe("displayPath", () => {
  let root: string;
  beforeEach(() => {
    root = makeWorkspace();
  });
  afterEach(() => cleanup(root));

  it("returns '.' for the root itself", () => {
    expect(displayPath(root, root)).toBe(".");
  });

  it("returns a relative path for a child of the root", () => {
    expect(displayPath(path.join(root, "sub", "f.txt"), root)).toBe(path.join("sub", "f.txt"));
  });

  it("returns the absolute path for a target outside the root", () => {
    const outside = path.resolve(root, "..", "elsewhere.txt");
    expect(displayPath(outside, root)).toBe(outside);
  });
});
