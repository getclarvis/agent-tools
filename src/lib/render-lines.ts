export const MAX_LINE = 2000;
const LINE_TRUNC = " [... line truncated ...]";

function capBytes(content: string, maxBytes: number): string {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) return content;
  const room = Math.max(0, maxBytes - Buffer.byteLength(LINE_TRUNC, "utf8"));
  const buf = Buffer.from(content, "utf8");
  let end = Math.min(room, buf.length);
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf8") + LINE_TRUNC;
}

export interface RenderedSlice {
  body: string;
  shownLines: number;
  byteCapped: boolean;
}

export function renderNumberedSlice(
  lines: string[],
  start: number,
  hardEnd: number,
  maxBytes: number,
): RenderedSlice {
  const out: string[] = [];
  let used = 0;
  let end = start;
  for (let i = start; i < hardEnd; i++) {
    let content = lines[i] ?? "";
    if (content.length > MAX_LINE) {
      let cut = MAX_LINE;
      const code = content.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
      content = content.slice(0, cut) + LINE_TRUNC;
    }
    const prefix = `${String(i + 1).padStart(6)}\t`;
    content = capBytes(content, maxBytes - Buffer.byteLength(prefix, "utf8") - 1);
    const row = prefix + content;
    const rowBytes = Buffer.byteLength(row, "utf8") + 1;
    if (i > start && used + rowBytes > maxBytes) break;
    out.push(row);
    used += rowBytes;
    end = i + 1;
  }
  return { body: out.join("\n"), shownLines: end - start, byteCapped: end < hardEnd };
}
