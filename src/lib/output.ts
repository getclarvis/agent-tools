import { promises as fs } from "node:fs";
import path from "node:path";

function cutPoint(buf: Buffer, maxBytes: number): number {
  let end = maxBytes;
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--;
  return end;
}

function truncate(
  text: string,
  maxBytes: number,
): { shown: string; end: number; total: number } | null {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return null;
  const end = cutPoint(buf, maxBytes);
  return { shown: buf.subarray(0, end).toString("utf8"), end, total: buf.length };
}

function truncateTail(
  text: string,
  maxBytes: number,
): { shown: string; shownBytes: number; total: number } | null {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return null;
  let start = buf.length - maxBytes;
  while (start < buf.length && ((buf[start] ?? 0) & 0xc0) === 0x80) start++;
  return {
    shown: buf.subarray(start).toString("utf8"),
    shownBytes: buf.length - start,
    total: buf.length,
  };
}

function truncationMarker(end: number, total: number): string {
  return `\n[... output truncated: ${end} of ${total} bytes shown ...]`;
}

export function bound(text: string, maxBytes: number): string {
  const t = truncate(text, maxBytes);
  if (t === null) return text;
  return t.shown + truncationMarker(t.end, t.total);
}

const SPILL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function sweepSpillDir(workspaceRoot: string): Promise<void> {
  const dir = path.join(workspaceRoot, ".clarvis");
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    entries.map(async (e) => {
      if (!e.isFile() || !e.name.startsWith("bash-")) return;
      const p = path.join(dir, e.name);
      try {
        const st = await fs.stat(p);
        if (now - st.mtimeMs > SPILL_MAX_AGE_MS) await fs.rm(p, { force: true });
      } catch {
        return;
      }
    }),
  );
}

export function allocateBudget(aBytes: number, bBytes: number, total: number): [number, number] {
  if (aBytes + bBytes <= total) return [aBytes, bBytes];
  const half = Math.floor(total / 2);
  if (aBytes <= half) return [aBytes, total - aBytes];
  if (bBytes <= half) return [total - bBytes, bBytes];
  return [total - half, half];
}

function tailMarker(shownBytes: number, total: number, spillPath?: string): string {
  const where = spillPath !== undefined ? `; full output written to ${spillPath}` : "";
  return `[... earlier output truncated: last ${shownBytes} of ${total} bytes shown${where} ...]\n`;
}

export async function boundOrSpill(
  text: string,
  maxBytes: number,
  spill: { absPath: string; displayPath: string },
): Promise<string> {
  const t = truncateTail(text, maxBytes);
  if (t === null) return text;

  try {
    const dir = path.dirname(spill.absPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, ".gitignore"), "*\n", { flag: "wx" }).catch(() => {});
    await fs.writeFile(spill.absPath, text, "utf8");
    return tailMarker(t.shownBytes, t.total, spill.displayPath) + t.shown;
  } catch {
    return tailMarker(t.shownBytes, t.total) + t.shown;
  }
}
