import { diffArrays } from "diff";

const BOM = "﻿";

export type Eol = "lf" | "crlf";

export type Encoding = "utf8" | "utf16le" | "utf16be";

export interface DecodedText {
  content: string;

  eol: Eol;

  bom: boolean;

  raw: string;

  encoding: Encoding;
}

export function decodeText(buf: Buffer): DecodedText {
  let encoding: Encoding = "utf8";
  let raw: string;
  let bom = false;

  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    encoding = "utf16le";
    bom = true;
    raw = buf.subarray(2).toString("utf16le");
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    encoding = "utf16be";
    bom = true;
    const body = buf.subarray(2);
    const even = body.length - (body.length % 2);
    const swapped = Buffer.from(body.subarray(0, even));
    swapped.swap16();
    raw = swapped.toString("utf16le");
  } else {
    raw = buf.toString("utf8");
    if (raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
      bom = true;
    }
  }

  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) === 0x0a) {
      if (i > 0 && raw.charCodeAt(i - 1) === 0x0d) crlf++;
      else lf++;
    }
  }

  const eol: Eol = crlf > lf ? "crlf" : "lf";

  const content = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return { content, eol, bom, raw, encoding };
}

export function encodeText(content: string, opts: { eol: Eol; bom: boolean }): string {
  let out = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (opts.eol === "crlf") {
    out = out.replace(/\n/g, "\r\n");
  }
  return opts.bom ? BOM + out : out;
}

export function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0x0a) n++;
  }
  return n;
}

interface Line {
  text: string;
  end: string;
}

function tokenize(s: string): Line[] {
  const parts = s.split(/(\r\n|\r|\n)/);
  const lines: Line[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i] ?? "";
    const end = parts[i + 1] ?? "";
    if (text === "" && end === "" && i > 0) break;
    lines.push({ text, end });
  }
  return lines;
}

function dominantEnd(lines: Line[]): string {
  const counts = new Map<string, number>();
  for (const { end } of lines) {
    if (end === "") continue;
    counts.set(end, (counts.get(end) ?? 0) + 1);
  }
  let best = "\n";
  let bestCount = 0;
  for (const [end, count] of counts) {
    if (count > bestCount) {
      best = end;
      bestCount = count;
    }
  }
  return best;
}

export function reencode(newContent: string, decoded: DecodedText): string {
  const oldLines = tokenize(decoded.raw);
  const newLines = tokenize(newContent);
  const dominant = dominantEnd(oldLines);

  const mapped: (string | null)[] = newLines.map(() => null);
  const parts = diffArrays(
    oldLines.map((l) => l.text),
    newLines.map((l) => l.text),
  );
  let oi = 0;
  let ni = 0;
  for (const part of parts) {
    const count = part.count ?? part.value.length;
    if (part.added) {
      ni += count;
    } else if (part.removed) {
      oi += count;
    } else {
      for (let k = 0; k < count; k++) {
        mapped[ni] = oldLines[oi]?.end ?? null;
        oi++;
        ni++;
      }
    }
  }

  let out = "";
  for (let i = 0; i < newLines.length; i++) {
    const line = newLines[i];
    if (line === undefined) continue;
    out += line.text;
    if (line.end === "") continue;
    const orig = mapped[i];
    out += orig !== null && orig !== "" ? orig : dominant;
  }

  return decoded.bom ? BOM + out : out;
}
