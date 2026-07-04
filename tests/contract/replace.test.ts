import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { symlinkSync, lstatSync } from "node:fs";
import path from "node:path";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  write,
  writeBinary,
  read,
} from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

let root: string;
let config: ServerConfig;

beforeEach(() => {
  root = makeWorkspace();
  config = makeConfig(root);
});
afterEach(() => cleanup(root));

describe("replace — dry run (default)", () => {
  it("previews the counts and diff without writing", async () => {
    write(root, "a.ts", "const foo = 1;\nconst foo2 = foo;\n");
    const r = await callTool(
      "replace",
      { pattern: "foo", replacement: "bar", glob: "**/*.ts" },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toContain("replacement(s)");
    expect(r.text).toContain("dry run");
    expect(r.text).toContain("-const foo = 1;");
    expect(r.text).toContain("+const bar = 1;");
    expect(read(root, "a.ts")).toBe("const foo = 1;\nconst foo2 = foo;\n");
  });

  it("reports (no matches) when nothing matches", async () => {
    write(root, "a.ts", "hello\n");
    const r = await callTool(
      "replace",
      { pattern: "zzz", replacement: "x", glob: "**/*.ts" },
      config,
    );
    expect(r.text).toBe("(no matches)");
  });
});

describe("replace — apply", () => {
  it("applies atomically when dry_run is false", async () => {
    write(root, "a.ts", "foo foo foo\n");
    const r = await callTool(
      "replace",
      { pattern: "foo", replacement: "bar", glob: "**/*.ts", dry_run: false },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Replaced 3 occurrence(s) in 1 file(s)");
    expect(read(root, "a.ts")).toBe("bar bar bar\n");
  });

  it("edits every matching file across the tree", async () => {
    write(root, "src/a.ts", "old();\n");
    write(root, "src/sub/b.ts", "old(); old();\n");
    const r = await callTool(
      "replace",
      { pattern: "old", replacement: "renewed", glob: "**/*.ts", dry_run: false },
      config,
    );
    expect(r.isError).toBe(false);
    expect(read(root, "src/a.ts")).toBe("renewed();\n");
    expect(read(root, "src/sub/b.ts")).toBe("renewed(); renewed();\n");
  });

  it("substitutes capture groups with $1", async () => {
    write(root, "a.ts", "getUser(id)\n");
    await callTool(
      "replace",
      {
        pattern: "getUser\\((\\w+)\\)",
        replacement: "fetchUser($1)",
        path: "a.ts",
        dry_run: false,
      },
      config,
    );
    expect(read(root, "a.ts")).toBe("fetchUser(id)\n");
  });

  it("honors ignore_case", async () => {
    write(root, "a.ts", "Foo FOO foo\n");
    await callTool(
      "replace",
      { pattern: "foo", replacement: "bar", path: "a.ts", ignore_case: true, dry_run: false },
      config,
    );
    expect(read(root, "a.ts")).toBe("bar bar bar\n");
  });

  it("matches across lines with multiline", async () => {
    write(root, "a.ts", "start\nmiddle\nend\n");
    await callTool(
      "replace",
      { pattern: "start.*end", replacement: "X", path: "a.ts", multiline: true, dry_run: false },
      config,
    );
    expect(read(root, "a.ts")).toBe("X\n");
  });

  it("preserves CRLF line endings", async () => {
    write(root, "a.ts", "foo\r\nbar\r\n");
    await callTool(
      "replace",
      { pattern: "foo", replacement: "baz", path: "a.ts", dry_run: false },
      config,
    );
    expect(read(root, "a.ts")).toBe("baz\r\nbar\r\n");
  });

  it("walks a directory scope when no glob is given", async () => {
    write(root, "src/a.ts", "foo\n");
    write(root, "src/b.js", "foo\n");
    await callTool(
      "replace",
      { pattern: "foo", replacement: "bar", path: "src", dry_run: false },
      config,
    );
    expect(read(root, "src/a.ts")).toBe("bar\n");
    expect(read(root, "src/b.js")).toBe("bar\n");
  });

  it("expands a bare glob without a slash to match in any directory", async () => {
    write(root, "deep/dir/x.ts", "foo\n");
    await callTool(
      "replace",
      { pattern: "foo", replacement: "bar", glob: "*.ts", dry_run: false },
      config,
    );
    expect(read(root, "deep/dir/x.ts")).toBe("bar\n");
  });

  it("reports no matches when the replacement equals the match (no net change)", async () => {
    write(root, "a.ts", "foo\n");
    const r = await callTool(
      "replace",
      { pattern: "foo", replacement: "foo", path: "a.ts" },
      config,
    );
    expect(r.text).toBe("(no matches)");
    expect(read(root, "a.ts")).toBe("foo\n");
  });

  it("uses the singular form for a one-occurrence summary", async () => {
    write(root, "a.ts", "foo bar\n");
    const r = await callTool(
      "replace",
      { pattern: "foo", replacement: "baz", path: "a.ts", dry_run: false },
      config,
    );
    expect(r.text).toContain("(1 replacement)");
  });

  it("skips gitignored files", async () => {
    write(root, ".git/HEAD", "ref: refs/heads/main\n");
    write(root, ".gitignore", "vendor/\n");
    write(root, "vendor/lib.ts", "foo\n");
    write(root, "app.ts", "foo\n");
    await callTool(
      "replace",
      { pattern: "foo", replacement: "bar", glob: "**/*.ts", dry_run: false },
      config,
    );
    expect(read(root, "app.ts")).toBe("bar\n");
    expect(read(root, "vendor/lib.ts")).toBe("foo\n");
  });

  it("refuses to write through a symlink, leaving the target intact", async () => {
    write(root, "real.txt", "original\n");
    symlinkSync(path.join(root, "real.txt"), path.join(root, "link.txt"));
    const r = await callTool(
      "replace",
      { pattern: "original", replacement: "changed", path: "link.txt", dry_run: false },
      config,
    );
    expect(r.json.error).toBe("invalid_input");
    expect(read(root, "real.txt")).toBe("original\n");
    expect(lstatSync(path.join(root, "link.txt")).isSymbolicLink()).toBe(true);
  });

  it("skips binary and unreadable files silently", async () => {
    writeBinary(root, "b.ts");
    write(root, "ok.ts", "foo\n");
    const r = await callTool(
      "replace",
      { pattern: "foo", replacement: "bar", glob: "**/*.ts", dry_run: false },
      config,
    );
    expect(read(root, "ok.ts")).toBe("bar\n");
    expect(r.text).toContain("1 file(s)");
  });
});

describe("replace — validation and surface", () => {
  it("requires a path or glob", async () => {
    const r = await callTool("replace", { pattern: "foo", replacement: "bar" }, config);
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: "invalid_input" });
    expect(r.text).toContain("path");
  });

  it("rejects an invalid regex", async () => {
    const r = await callTool(
      "replace",
      { pattern: "foo(", replacement: "bar", glob: "**/*.ts" },
      config,
    );
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: "invalid_input" });
    expect(r.text).toContain("Invalid regex");
  });

  it("refuses a pattern that matches the empty string", async () => {
    write(root, "a.ts", "foo\n");
    const r = await callTool(
      "replace",
      { pattern: "x*", replacement: "y", glob: "**/*.ts" },
      config,
    );
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: "invalid_input" });
    expect(r.text).toContain("empty string");
  });

  it("returns not_found for a missing explicit path", async () => {
    const r = await callTool(
      "replace",
      { pattern: "foo", replacement: "bar", path: "missing.ts", dry_run: false },
      config,
    );
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: "not_found" });
  });

  it("is hidden in read-only mode", async () => {
    const ro = makeConfig(root, { readOnly: true });
    const r = await callTool("replace", { pattern: "a", replacement: "b", glob: "**/*" }, ro);
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: "not_found" });
  });

  it("annotates a syntax error introduced into a .ts file", async () => {
    write(root, "a.ts", "const x = 1;\n");
    const tsConfig = makeConfig(root, { treeSitterAvailable: true });
    const r = await callTool(
      "replace",
      { pattern: "1", replacement: "= =", path: "a.ts", dry_run: false },
      tsConfig,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toContain("warning:");
  });
});
