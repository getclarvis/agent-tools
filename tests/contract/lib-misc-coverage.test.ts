import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { makeWorkspace, cleanup, write, writeBinary } from "../helpers/fixtures.js";
import { decodeText, encodeText, reencode } from "../../src/lib/text.js";
import { readTextBuffer } from "../../src/lib/textfile.js";
import { isBinary, isUtf16Bom } from "../../src/lib/binary.js";
import { resolvePath, displayPath } from "../../src/lib/paths.js";

const BOM = "﻿";

describe("text.encodeText EOL/BOM handling", () => {
  it("rewrites LF to CRLF when eol=crlf (text.ts:64)", () => {
    expect(encodeText("a\nb\nc\n", { eol: "crlf", bom: false })).toBe("a\r\nb\r\nc\r\n");
  });

  it("normalizes CRLF input then re-emits CRLF when eol=crlf", () => {
    expect(encodeText("a\r\nb\r\n", { eol: "crlf", bom: false })).toBe("a\r\nb\r\n");
  });

  it("prepends a BOM and emits CRLF when eol=crlf and bom=true", () => {
    expect(encodeText("a\nb\n", { eol: "crlf", bom: true })).toBe(BOM + "a\r\nb\r\n");
  });

  it("leaves LF intact when eol=lf and bom=false", () => {
    expect(encodeText("a\r\nb\r\n", { eol: "lf", bom: false })).toBe("a\nb\n");
  });

  it("prepends a BOM but keeps LF when eol=lf and bom=true", () => {
    expect(encodeText("a\nb\n", { eol: "lf", bom: true })).toBe(BOM + "a\nb\n");
  });
});

describe("textfile.readTextBuffer failure paths", () => {
  let root: string;
  beforeEach(() => {
    root = makeWorkspace();
  });
  afterEach(() => cleanup(root));

  it("returns null when stat rejects for a missing file (textfile.ts:51)", async () => {
    const result = await readTextBuffer(path.join(root, "does-not-exist.txt"), 1_000_000);
    expect(result).toBeNull();
  });

  it("returns null when readFile rejects (EISDIR) for a directory (textfile.ts:58)", async () => {
    const dir = path.join(root, "a-directory");
    mkdirSync(dir);
    const result = await readTextBuffer(dir, 1_000_000);
    expect(result).toBeNull();
  });

  it("returns null when the file exceeds maxBytes", async () => {
    const p = write(root, "big.txt", "hello world\n");
    const result = await readTextBuffer(p, 0);
    expect(result).toBeNull();
  });

  it("returns null for a binary file", async () => {
    const p = writeBinary(root, "blob.bin");
    const result = await readTextBuffer(p, 1_000_000);
    expect(result).toBeNull();
  });

  it("decodes a readable text file", async () => {
    const p = write(root, "ok.txt", "hello\nworld\n");
    const result = await readTextBuffer(p, 1_000_000);
    expect(result).not.toBeNull();
    expect(result?.content).toBe("hello\nworld\n");
  });
});

describe("binary.isBinary large-buffer tail scan", () => {
  it("detects a NUL located only in the trailing scan window (binary.ts:10)", () => {
    const big = Buffer.alloc(9000, 0x61);
    big[8500] = 0;
    expect(isBinary(big)).toBe(true);
  });

  it("returns false for a large buffer with no NUL, exercising the tail loop", () => {
    const big = Buffer.alloc(9000, 0x61);
    expect(isBinary(big)).toBe(false);
  });

  it("returns false for a NUL that sits in the untested gap of a large buffer", () => {
    const big = Buffer.alloc(20000, 0x61);
    big[10000] = 0;
    expect(isBinary(big)).toBe(false);
  });

  it("detects a NUL in the head of a small buffer (early return)", () => {
    expect(isBinary(Buffer.from([0x61, 0x00, 0x62]))).toBe(true);
  });

  it("returns false for a small clean buffer", () => {
    expect(isBinary(Buffer.from("plain text", "utf8"))).toBe(false);
  });

  it("recognizes UTF-16 LE and BE BOMs and rejects others", () => {
    expect(isUtf16Bom(Buffer.from([0xff, 0xfe, 0x61, 0x00]))).toBe(true);
    expect(isUtf16Bom(Buffer.from([0xfe, 0xff, 0x00, 0x61]))).toBe(true);
    expect(isUtf16Bom(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(isUtf16Bom(Buffer.from([0xff]))).toBe(false);
  });
});

describe("paths canonicalize / resolve", () => {
  let root: string;
  beforeEach(() => {
    root = makeWorkspace();
  });
  afterEach(() => cleanup(root));

  it("falls back to path.normalize when the workspace root does not exist (paths.ts:34)", () => {
    const ghostRoot = path.join(root, "ghost", "sub");
    const result = resolvePath("file.txt", ghostRoot, true);
    expect(result).toBe(path.join(ghostRoot, "file.txt"));
  });

  it("resolves a relative path against an existing workspace with confine", () => {
    const result = resolvePath("nested/file.txt", root, true);
    expect(result).toBe(path.join(root, "nested", "file.txt"));
  });

  it("throws when a confined path escapes the workspace root (paths.ts:22)", () => {
    const outside = path.resolve(root, "..", "escapee.txt");
    expect(() => resolvePath(outside, root, true)).toThrow(/escapes the workspace root/);
  });

  it("canonicalizes an already-existing confined target with no missing tail (paths.ts:47-48)", () => {
    write(root, "here.txt", "x");
    const result = resolvePath("here.txt", root, true);
    expect(result).toBe(path.join(root, "here.txt"));
  });

  it("passes an absolute input through path.normalize", () => {
    const abs = path.join(root, "abs.txt");
    expect(resolvePath(abs, root, false)).toBe(abs);
  });

  it("displayPath returns '.' for the root itself", () => {
    expect(displayPath(root, root)).toBe(".");
  });

  it("displayPath returns a relative path for a child", () => {
    expect(displayPath(path.join(root, "sub", "f.txt"), root)).toBe(path.join("sub", "f.txt"));
  });

  it("displayPath returns the absolute path for a path outside the root", () => {
    const outside = path.resolve(root, "..", "elsewhere.txt");
    expect(displayPath(outside, root)).toBe(outside);
  });
});

describe("text.reencode diff-part traversal (added/removed/common)", () => {
  it("gives an inserted line the dominant ending (added diff-part; text.ts:131-132)", () => {
    const decoded = decodeText(Buffer.from("a\r\nb\r\n", "utf8"));
    expect(reencode("a\nNEW\nb\n", decoded)).toBe("a\r\nNEW\r\nb\r\n");
  });

  it("drops a removed line while keeping surviving endings (removed diff-part; text.ts:133-134)", () => {
    const decoded = decodeText(Buffer.from("a\r\nb\r\nc\r\n", "utf8"));
    expect(reencode("a\nc\n", decoded)).toBe("a\r\nc\r\n");
  });

  it("maps each common line back to its original per-line ending (common diff-part; text.ts:136-140)", () => {
    const decoded = decodeText(Buffer.from("a\r\nb\ngamma\r\n", "utf8"));
    expect(reencode("a\nb\ngamma\n", decoded)).toBe("a\r\nb\ngamma\r\n");
  });

  it("returns empty output for empty new content (tokenize/loop over a single blank line)", () => {
    const decoded = decodeText(Buffer.from("a\nb\n", "utf8"));
    expect(reencode("", decoded)).toBe("");
  });

  it("re-applies the BOM around remapped content (text.ts:154 bom arm)", () => {
    const decoded = decodeText(Buffer.from(BOM + "a\r\nb\n", "utf8"));
    expect(decoded.bom).toBe(true);
    expect(reencode(decoded.content, decoded)).toBe(BOM + "a\r\nb\n");
  });

  it("omits the BOM when the source had none (text.ts:154 non-bom arm)", () => {
    const decoded = decodeText(Buffer.from("a\nb\n", "utf8"));
    expect(decoded.bom).toBe(false);
    expect(reencode(decoded.content, decoded)).toBe("a\nb\n");
  });

  it("keeps a final line that has no trailing newline (tokenize end-fallback; text.ts:93)", () => {
    const decoded = decodeText(Buffer.from("a\nb", "utf8"));
    expect(reencode("a\nb", decoded)).toBe("a\nb");
  });

  it("uses the dominant ending for an insertion into a lone-CR (classic Mac) file", () => {
    const decoded = decodeText(Buffer.from("a\rb\r", "utf8"));
    expect(reencode("a\rINS\rb\r", decoded)).toBe("a\rINS\rb\r");
  });
});
