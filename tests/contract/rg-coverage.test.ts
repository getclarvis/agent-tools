import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  makeWorkspace,
  cleanup,
  makeConfig,
  callTool,
  write,
  writeBinary,
  chmod,
  isRoot,
} from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

const rgAvailable = (() => {
  try {
    return spawnSync("rg", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
})();

describe("grepSearch single-file pre-scan guards (engine-independent)", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { ripgrepAvailable: false });
  });
  afterEach(() => cleanup(root));

  it("returns no matches for a binary file target (isBinary true, line 57 early return)", async () => {
    writeBinary(root, "blob.bin");
    const r = await callTool(
      "grep",
      { pattern: "a", path: "blob.bin", output_mode: "content" },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("(no matches)");
  });

  it("searches a text file target when it is not binary (line 57 falls through)", async () => {
    write(root, "hello.txt", "needle here\nother\n");
    const r = await callTool(
      "grep",
      { pattern: "needle", path: "hello.txt", output_mode: "content" },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("hello.txt:1:needle here");
  });

  it("skips a file target larger than maxFileBytes (line 55 early return)", async () => {
    write(root, "big.txt", `needle ${"a".repeat(4096)}\n`);
    const small = makeConfig(root, { ripgrepAvailable: false, maxFileBytes: 1024 });
    const r = await callTool(
      "grep",
      { pattern: "needle", path: "big.txt", output_mode: "content" },
      small,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("(no matches)");
  });

  it.skipIf(isRoot)(
    "swallows a read error on the file target and yields no matches (line 58 catch)",
    async () => {
      write(root, "locked.txt", "needle here\n");
      chmod(root, "locked.txt", 0o000);
      const r = await callTool(
        "grep",
        { pattern: "needle", path: "locked.txt", output_mode: "content" },
        config,
      );
      expect(r.isError).toBe(false);
      expect(r.text).toBe("(no matches)");
      chmod(root, "locked.txt", 0o600);
    },
  );
});

describe.skipIf(!rgAvailable)("ripgrep single-file target (dirname/basename branch)", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { ripgrepAvailable: true });
  });
  afterEach(() => cleanup(root));

  it("searches a single file via cwd=dirname, arg=basename (lines 85-86)", async () => {
    write(root, "hello.txt", "needle here\nother\n");
    const r = await callTool(
      "grep",
      { pattern: "needle", path: "hello.txt", output_mode: "content" },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("hello.txt:1:needle here");
  });

  it("searches a nested single file, reporting the path relative to the workspace", async () => {
    write(root, "sub/deep/note.txt", "needle inside\n");
    const r = await callTool(
      "grep",
      { pattern: "needle", path: "sub/deep/note.txt", output_mode: "content" },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("sub/deep/note.txt:1:needle inside");
  });
});

describe.skipIf(!rgAvailable)("ripgrep stdout stream-cap truncation", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { ripgrepAvailable: true, maxOutputBytes: 1 });
  });
  afterEach(() => cleanup(root));

  it("kills rg once output exceeds the stream cap and skips the partial JSON line (101-102, 115)", async () => {
    write(root, "giant.txt", "y".repeat(500000) + "\n");
    const r = await callTool("grep", { pattern: "y", output_mode: "content" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("search incomplete");
  });

  it("truncates after parsing some complete matches (close handler resolves with matches)", async () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `hit ${i}`).join("\n");
    write(root, "many.txt", lines + "\n");
    const r = await callTool("grep", { pattern: "hit" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("search incomplete");
  });
});

describe.skipIf(!rgAvailable)("ripgrep non-UTF-8 JSON fields", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { ripgrepAvailable: true });
  });
  afterEach(() => cleanup(root));

  it("matches a line containing invalid UTF-8 (rg emits lines.bytes; line 124 `?? ''`)", async () => {
    const body = Buffer.concat([
      Buffer.from("needle "),
      Buffer.from([0xff]),
      Buffer.from(" tail\n"),
    ]);
    writeFileSync(`${root}/badline.txt`, body);
    const r = await callTool(
      "grep",
      { pattern: "needle", path: "badline.txt", output_mode: "content" },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("badline.txt:1:");
  });

  it("skips a match whose path is invalid UTF-8 (rg emits path.bytes; line 120 continue)", async () => {
    const badName = Buffer.concat([
      Buffer.from(`${root}/bad-`),
      Buffer.from([0xff]),
      Buffer.from(".txt"),
    ]);
    writeFileSync(badName, "needle here\n");
    const r = await callTool("grep", { pattern: "needle", output_mode: "content" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("(no matches)");
  });
});

describe("in-process grep multiline & context branches", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { ripgrepAvailable: false });
  });
  afterEach(() => cleanup(root));

  it("multiline + ignore_case selects the 'gmsi' flag arm (line 151)", async () => {
    write(root, "ml.txt", "ALPHA\nBETA\ngamma\n");
    const r = await callTool(
      "grep",
      { pattern: "alpha\\nbeta", output_mode: "content", multiline: true, ignore_case: true },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("ml.txt:1:ALPHA\nBETA");
  });

  it("breaks the file loop once a prior file overflowed the budget (line 169 truncated break)", async () => {
    const tiny = makeConfig(root, { ripgrepAvailable: false, maxOutputBytes: 1 });
    write(root, "a.txt", "needle here\n");
    write(root, "b.txt", "needle also\n");
    const r = await callTool("grep", { pattern: "needle", output_mode: "content" }, tiny);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("search incomplete");
  });

  it("emits a plain single-line match with no context (line 180 test, line 202 emit)", async () => {
    write(root, "p.txt", "one\nneedle\nthree\n");
    const r = await callTool("grep", { pattern: "needle", output_mode: "content" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("p.txt:2:needle");
  });

  it("emits single-line matches with before/after context (lines 196/197)", async () => {
    write(root, "c.txt", "l1\nl2\nneedle\nl4\nl5\n");
    const r = await callTool(
      "grep",
      { pattern: "needle", output_mode: "content", context: 1 },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("c.txt-2-l2\nc.txt:3:needle\nc.txt-4-l4");
  });

  it("drops zero-width multiline matches via the length-0 continue (line 241)", async () => {
    write(root, "z.txt", "abc\ndef\n");
    const r = await callTool(
      "grep",
      { pattern: "q*", output_mode: "content", multiline: true },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("(no matches)");
  });

  it("multiline match at the FIRST line: before-context underflows (line 282 r<0), after-context added (line 286)", async () => {
    write(root, "m1.txt", "ALPHA\nBETA\ntail\n");
    const r = await callTool(
      "grep",
      {
        pattern: "ALPHA\\nBETA",
        output_mode: "content",
        multiline: true,
        before_context: 1,
        after_context: 1,
      },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toContain("m1.txt:1:ALPHA\nBETA");
    expect(r.text).toContain("m1.txt-3-tail");
  });

  it("multiline match at the LAST line: before-context added (line 282), after-context overflows (line 286 r>=len)", async () => {
    write(root, "m2.txt", "head\nALPHA\nBETA\n");
    const r = await callTool(
      "grep",
      {
        pattern: "ALPHA\\nBETA",
        output_mode: "content",
        multiline: true,
        before_context: 1,
        after_context: 1,
      },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toContain("m2.txt-1-head");
    expect(r.text).toContain("m2.txt:2:ALPHA\nBETA");
  });

  it("multiline dotall span across three lines exercises lineOf + span emit (lines 231/242/245/293/294)", async () => {
    write(root, "span.txt", "START x\nmid\ny END\n");
    const r = await callTool(
      "grep",
      { pattern: "START.*END", output_mode: "content", multiline: true },
      config,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("span.txt:1:START x\nmid\ny END");
  });
});
