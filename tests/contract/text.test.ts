import { describe, expect, it } from "vitest";
import { decodeText, reencode } from "../../src/lib/text.js";

function roundtrip(s: string): string {
  const decoded = decodeText(Buffer.from(s, "utf8"));
  return reencode(decoded.content, decoded);
}

describe("text EOL/BOM round-trip", () => {
  it("preserves a pure-CRLF file untouched", () => {
    expect(roundtrip("alpha\r\nbeta\r\ngamma\r\n")).toBe("alpha\r\nbeta\r\ngamma\r\n");
  });

  it("preserves a pure-LF file untouched", () => {
    expect(roundtrip("alpha\nbeta\n")).toBe("alpha\nbeta\n");
  });

  it("preserves a mixed-EOL file line-by-line (BUG-07)", () => {
    expect(roundtrip("alpha\r\nbeta\ngamma\r\n")).toBe("alpha\r\nbeta\ngamma\r\n");
  });

  it("preserves a classic-Mac (lone CR) file untouched (BUG-08)", () => {
    expect(roundtrip("alpha\rbeta\rgamma\r")).toBe("alpha\rbeta\rgamma\r");
  });

  it("preserves an embedded lone CR as a line terminator", () => {
    expect(roundtrip("alpha\rbeta\n")).toBe("alpha\rbeta\n");
  });

  it("preserves a UTF-8 BOM and the original endings", () => {
    expect(roundtrip("﻿alpha\r\nbeta\n")).toBe("﻿alpha\r\nbeta\n");
  });

  it("keeps untouched lines' endings when one line is edited (no churn)", () => {
    const decoded = decodeText(Buffer.from("a\r\nb\r\nc\nd\r\n", "utf8"));
    const edited = decoded.content.replace("a", "A");
    expect(reencode(edited, decoded)).toBe("A\r\nb\r\nc\nd\r\n");
  });

  it("gives an inserted line the dominant ending", () => {
    const decoded = decodeText(Buffer.from("a\r\nb\r\n", "utf8"));
    expect(reencode("a\nINS\nb\n", decoded)).toBe("a\r\nINS\r\nb\r\n");
  });

  it("respects removal of the final newline", () => {
    const decoded = decodeText(Buffer.from("a\nb\n", "utf8"));
    expect(reencode("a\nb", decoded)).toBe("a\nb");
  });
});

describe("text encoding detection", () => {
  it("decodes a UTF-16LE (BOM) buffer and reports the encoding", () => {
    const decoded = decodeText(Buffer.from("﻿hello\nworld\n", "utf16le"));
    expect(decoded.encoding).toBe("utf16le");
    expect(decoded.content).toBe("hello\nworld\n");
    expect(decoded.bom).toBe(true);
  });

  it("decodes a UTF-16BE (BOM) buffer and reports the encoding", () => {
    const buf = Buffer.from("﻿hello\nworld\n", "utf16le");
    buf.swap16();
    const decoded = decodeText(buf);
    expect(decoded.encoding).toBe("utf16be");
    expect(decoded.content).toBe("hello\nworld\n");
    expect(decoded.bom).toBe(true);
  });

  it("reports utf8 for a plain UTF-8 buffer", () => {
    expect(decodeText(Buffer.from("hello\n", "utf8")).encoding).toBe("utf8");
  });

  it("reports utf8 (with bom) for a UTF-8 BOM buffer", () => {
    const decoded = decodeText(Buffer.from("﻿hello\n", "utf8"));
    expect(decoded.encoding).toBe("utf8");
    expect(decoded.bom).toBe(true);
  });
});
