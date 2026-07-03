import { promises as fs } from "node:fs";

export interface LogSlice {
  text: string;
  nextOffset: number;
  total: number;
  more: boolean;
}

export async function readLogSlice(
  logPath: string,
  offset: number,
  maxBytes: number,
): Promise<LogSlice> {
  let total: number;
  try {
    total = (await fs.stat(logPath)).size;
  } catch {
    return { text: "", nextOffset: Math.max(0, offset), total: 0, more: false };
  }

  const start = Math.min(Math.max(0, offset), total);
  const available = total - start;
  if (available <= 0) {
    return { text: "", nextOffset: start, total, more: false };
  }

  const want = Math.min(available, maxBytes);
  const buf = Buffer.alloc(want);
  const fh = await fs.open(logPath, "r");
  let bytesRead: number;
  try {
    ({ bytesRead } = await fh.read(buf, 0, want, start));
  } finally {
    await fh.close();
  }

  let consumed = bytesRead;
  const budgetCut = start + consumed < total;
  if (budgetCut && consumed > 0) {
    let i = consumed - 1;
    let cont = 0;
    while (i >= 0 && ((buf[i] ?? 0) & 0xc0) === 0x80) {
      i--;
      cont++;
    }
    if (i >= 0) {
      const lead = buf[i] ?? 0;
      let expected = 1;
      if ((lead & 0xe0) === 0xc0) expected = 2;
      else if ((lead & 0xf0) === 0xe0) expected = 3;
      else if ((lead & 0xf8) === 0xf0) expected = 4;
      if (cont + 1 < expected) consumed = i;
    }
    if (consumed === 0) consumed = bytesRead;
  }

  const text = buf.subarray(0, consumed).toString("utf8");
  const nextOffset = start + consumed;
  return { text, nextOffset, total, more: nextOffset < total };
}
