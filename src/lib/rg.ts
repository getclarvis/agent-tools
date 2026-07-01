import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ToolError, fsError } from "../errors.js";
import { isBinary } from "../lib/binary.js";
import { listFiles } from "../lib/files.js";
import { splitLines } from "../lib/text.js";
import { readTextBuffer } from "../lib/textfile.js";
import type { ServerConfig } from "../config.js";

export interface GrepParams {
  pattern: string;
  searchRoot: string;
  glob?: string;
  ignoreCase: boolean;
  before: number;
  after: number;
  multiline: boolean;
}

export interface Match {
  file: string;
  lineNumber: number;
  text: string;
  kind: "match" | "context";
}

interface RgEvent {
  type?: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
  };
}

export interface GrepResult {
  matches: Match[];
  truncated: boolean;
}

const RG_JSON_OVERHEAD = 8;

export async function grepSearch(params: GrepParams, config: ServerConfig): Promise<GrepResult> {
  let stat;
  try {
    stat = await fs.stat(params.searchRoot);
  } catch (err) {
    throw fsError(err as NodeJS.ErrnoException, params.searchRoot);
  }

  const isDir = stat.isDirectory();

  if (!isDir) {
    if (stat.size > config.maxFileBytes) return { matches: [], truncated: false };
    try {
      if (isBinary(await fs.readFile(params.searchRoot))) return { matches: [], truncated: false };
    } catch {}
  }

  return config.ripgrepAvailable
    ? ripgrepSearch(params, isDir, config)
    : inProcessSearch(params, config, isDir);
}

function ripgrepSearch(
  params: GrepParams,
  isDir: boolean,
  config: ServerConfig,
): Promise<GrepResult> {
  const args = ["--no-config", "--json", "--hidden", "-g", "!.git"];
  args.push("--max-filesize", String(config.maxFileBytes));
  if (params.ignoreCase) args.push("-i");
  if (params.multiline) args.push("--multiline", "--multiline-dotall");
  if (params.before > 0) args.push("-B", String(params.before));
  if (params.after > 0) args.push("-A", String(params.after));

  let cwd: string;
  let searchArg: string;
  if (isDir) {
    cwd = params.searchRoot;
    searchArg = ".";
    if (params.glob) args.push("-g", params.glob);
  } else {
    cwd = path.dirname(params.searchRoot);
    searchArg = path.basename(params.searchRoot);
  }
  args.push("--", params.pattern, searchArg);

  return new Promise((resolve, reject) => {
    const child = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"], cwd });
    let out = "";
    let errOut = "";
    let truncated = false;
    const streamCap = config.maxOutputBytes * RG_JSON_OVERHEAD;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      if (truncated) return;
      out += d;
      if (out.length > streamCap) {
        truncated = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (d) => (errOut += d));
    child.on("error", (e) => reject(new ToolError("io_error", `Failed to run rg: ${e.message}`)));
    child.on("close", (code) => {
      const matches: Match[] = [];
      for (const line of out.split("\n")) {
        if (!line) continue;
        let evt: RgEvent;
        try {
          evt = JSON.parse(line) as RgEvent;
        } catch {
          continue;
        }
        if (evt.type !== "match" && evt.type !== "context") continue;
        const filePath = evt.data?.path?.text;
        const lineNumber = evt.data?.line_number;
        if (filePath === undefined || lineNumber === undefined) continue;
        matches.push({
          file: path.resolve(cwd, filePath),
          lineNumber,
          text: stripNewline(evt.data?.lines?.text ?? ""),
          kind: evt.type,
        });
      }

      if (matches.length === 0 && code === 2 && !truncated) {
        reject(
          new ToolError("invalid_input", `ripgrep error: ${errOut.trim()}`, {
            pattern: params.pattern,
          }),
        );
        return;
      }
      resolve({ matches, truncated });
    });
  });
}

async function inProcessSearch(
  params: GrepParams,
  config: ServerConfig,
  isDir: boolean,
): Promise<GrepResult> {
  const files = isDir ? await gatherFiles(params, config) : [params.searchRoot];
  let re: RegExp;
  const flags = params.multiline
    ? params.ignoreCase
      ? "gmsi"
      : "gms"
    : params.ignoreCase
      ? "i"
      : "";
  try {
    re = new RegExp(params.pattern, flags);
  } catch (err) {
    throw new ToolError("invalid_input", `Invalid regex: ${(err as Error).message}`, {
      pattern: params.pattern,
    });
  }
  const matches: Match[] = [];
  const budget = config.maxOutputBytes;
  let used = 0;
  let truncated = false;

  for (const file of files) {
    if (truncated) break;
    const decoded = await readTextBuffer(file, config.maxFileBytes);
    if (!decoded) continue;

    const lines = splitLines(decoded.content);

    if (params.multiline) {
      used += emitMultiline(matches, file, decoded.content, lines, re, params);
    } else {
      const hitRows = new Set<number>();
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i] ?? "")) hitRows.add(i);
      }
      if (hitRows.size === 0) continue;

      if (params.before > 0 || params.after > 0) {
        const emit = new Map<number, "match" | "context">();
        for (const row of hitRows) emit.set(row, "match");
        for (const row of hitRows) {
          for (let d = 1; d <= params.before; d++) {
            if (row - d >= 0 && !emit.has(row - d)) emit.set(row - d, "context");
          }
          for (let d = 1; d <= params.after; d++) {
            if (row + d < lines.length && !emit.has(row + d)) emit.set(row + d, "context");
          }
        }
        for (const row of [...emit.keys()].sort((a, b) => a - b)) {
          const text = lines[row] ?? "";
          matches.push({ file, lineNumber: row + 1, text, kind: emit.get(row) ?? "match" });
          used += Buffer.byteLength(text, "utf8");
        }
      } else {
        for (const row of [...hitRows].sort((a, b) => a - b)) {
          const text = lines[row] ?? "";
          matches.push({ file, lineNumber: row + 1, text, kind: "match" });
          used += Buffer.byteLength(text, "utf8");
        }
      }
    }

    if (used > budget) truncated = true;
  }
  return { matches, truncated };
}

function emitMultiline(
  matches: Match[],
  file: string,
  content: string,
  lines: string[],
  re: RegExp,
  params: GrepParams,
): number {
  const nl: number[] = [];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 0x0a) nl.push(i);
  }
  const lineOf = (off: number): number => {
    let lo = 0;
    let hi = nl.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((nl[mid] ?? 0) < off) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const matchedLines = new Set<number>();
  const multiLines = new Set<number>();
  for (const m of content.matchAll(re)) {
    const t = m[0];
    if (t.length === 0) continue;
    const startIdx = m.index ?? 0;
    const s = lineOf(startIdx);
    let e = lineOf(startIdx + t.length - 1);
    if (e >= lines.length) e = lines.length - 1;
    for (let L = s; L <= e; L++) {
      matchedLines.add(L);
      if (e > s) multiLines.add(L);
    }
  }
  if (matchedLines.size === 0) return 0;

  const runs: { start: number; end: number; hasMulti: boolean }[] = [];
  for (const L of [...matchedLines].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && L === last.end + 1) {
      last.end = L;
      if (multiLines.has(L)) last.hasMulti = true;
    } else {
      runs.push({ start: L, end: L, hasMulti: multiLines.has(L) });
    }
  }

  const emit = new Map<number, "match" | "context">();
  const anchorEnd = new Map<number, number>();
  for (const r of runs) {
    if (r.hasMulti) {
      emit.set(r.start, "match");
      anchorEnd.set(r.start, r.end);
    } else {
      for (let L = r.start; L <= r.end; L++) {
        emit.set(L, "match");
        anchorEnd.set(L, L);
      }
    }
  }

  if (params.before > 0 || params.after > 0) {
    for (const [start, end] of anchorEnd) {
      for (let d = 1; d <= params.before; d++) {
        const r = start - d;
        if (r >= 0 && !matchedLines.has(r) && !emit.has(r)) emit.set(r, "context");
      }
      for (let d = 1; d <= params.after; d++) {
        const r = end + d;
        if (r < lines.length && !matchedLines.has(r) && !emit.has(r)) emit.set(r, "context");
      }
    }
  }

  let used = 0;
  for (const row of [...emit.keys()].sort((a, b) => a - b)) {
    const kind = emit.get(row) ?? "match";
    const end = kind === "match" ? (anchorEnd.get(row) ?? row) : row;
    const text = lines.slice(row, end + 1).join("\n");
    matches.push({ file, lineNumber: row + 1, text, kind });
    used += Buffer.byteLength(text, "utf8");
  }
  return used;
}

async function gatherFiles(params: GrepParams, config: ServerConfig): Promise<string[]> {
  const pattern = params.glob
    ? params.glob.includes("/")
      ? params.glob
      : `**/${params.glob}`
    : "**/*";
  const kept = await listFiles(params.searchRoot, config.workspaceRoot, {
    pattern,
    respectGitignore: true,
  });
  kept.sort();
  return kept;
}

function stripNewline(s: string): string {
  return s.replace(/\r?\n$/, "");
}
