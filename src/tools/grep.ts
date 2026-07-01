import { resolvePath, displayPath } from "../lib/paths.js";
import { bound } from "../lib/output.js";
import { countNewlines } from "../lib/text.js";
import { grepSearch, type Match } from "../lib/rg.js";
import type { ServerConfig } from "../config.js";
import type { ToolDef } from "./types.js";

type OutputMode = "content" | "files_with_matches" | "count";

interface ContextOpts {
  before: number;
  after: number;
  offset: number;
  headLimit: number | undefined;
}

interface Formatted {
  rendered: string;
  unitTotal: number;
  shownUnits: number;
}

export const grep: ToolDef = {
  name: "grep",
  description:
    "Search file CONTENTS by regular expression, recursively (ripgrep-backed when available, else " +
    "an equivalent JS fallback). Use this to find where text or a symbol appears — do NOT read " +
    "whole files with read_file to look for a string. .gitignore and binary files are skipped. No " +
    "matches returns `(no matches)` — a success, not an error.",
  bounded: true,
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          "Regular expression (ripgrep / Rust regex syntax). Escape regex metacharacters to match " +
          "them literally.",
      },
      path: {
        type: "string",
        description:
          "File or directory to search. Relative to workspace root or absolute. Default: " +
          "workspace root.",
      },
      glob: {
        type: "string",
        description: 'Restrict the search to files matching this glob, e.g. "*.ts".',
      },
      output_mode: {
        type: "string",
        enum: ["content", "files_with_matches", "count"],
        default: "files_with_matches",
        description:
          'What to return: "files_with_matches" (default) lists matching file paths; "content" ' +
          'lists matching lines as path:line:text; "count" lists path:match_count per file.',
      },
      ignore_case: {
        type: "boolean",
        default: false,
        description: "Case-insensitive matching. Default false.",
      },
      multiline: {
        type: "boolean",
        default: false,
        description:
          "Match across line boundaries (ripgrep --multiline --multiline-dotall). When true, `.` " +
          "also matches newlines and `^`/`$` anchor at line boundaries, so one match may span " +
          "multiple lines. Applies in all output modes. Default false.",
      },
      context: {
        type: "integer",
        minimum: 0,
        default: 0,
        description:
          "Lines of context on BOTH sides of each match (shorthand for before_context and " +
          "after_context). Applies to content mode only. Default 0.",
      },
      before_context: {
        type: "integer",
        minimum: 0,
        description:
          "Lines of context BEFORE each match (ripgrep -B); overrides `context` for the before " +
          "side. Content mode only.",
      },
      after_context: {
        type: "integer",
        minimum: 0,
        description:
          "Lines of context AFTER each match (ripgrep -A); overrides `context` for the after " +
          "side. Content mode only.",
      },
      head_limit: {
        type: "integer",
        minimum: 1,
        description:
          "Max number of results to return — files in files_with_matches/count modes, matches in " +
          "content mode. Omit for unlimited (output is still byte-bounded). Page by re-running " +
          "with offset advanced per the footer.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        default: 0,
        description:
          "Number of leading results to skip (0-based). Re-run with a higher offset to page. " +
          "Note: this is a result offset, not read_file's 1-based line offset.",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const mode = args.output_mode as OutputMode;
    const ctx = mode === "content" ? (args.context as number) : 0;
    const before = mode === "content" ? ((args.before_context as number | undefined) ?? ctx) : 0;
    const after = mode === "content" ? ((args.after_context as number | undefined) ?? ctx) : 0;
    const offset = args.offset as number;
    const headLimit = args.head_limit as number | undefined;
    const multiline = args.multiline as boolean;

    const searchRoot = resolvePath(
      (args.path as string | undefined) ?? ".",
      config.workspaceRoot,
      config.confineToWorkspace,
    );

    const { matches, truncated } = await grepSearch(
      {
        pattern: args.pattern as string,
        searchRoot,
        glob: args.glob as string | undefined,
        ignoreCase: args.ignore_case as boolean,
        before,
        after,
        multiline,
      },
      config,
    );

    const { rendered, unitTotal, shownUnits } = format(matches, mode, config, {
      before,
      after,
      offset,
      headLimit,
    });

    return composeResult(rendered, config, { truncated, unitTotal, shownUnits, offset });
  },
};

function paginate<T>(items: T[], offset: number, headLimit: number | undefined): T[] {
  const end = headLimit === undefined ? items.length : offset + headLimit;
  return items.slice(offset, end);
}

function format(
  matches: Match[],
  mode: OutputMode,
  config: ServerConfig,
  opts: ContextOpts,
): Formatted {
  if (matches.length === 0) return { rendered: "(no matches)", unitTotal: 0, shownUnits: 0 };

  if (mode === "files_with_matches") {
    const files = [
      ...new Set(
        matches
          .filter((m) => m.kind === "match")
          .map((m) => displayPath(m.file, config.workspaceRoot)),
      ),
    ].sort();
    const page = paginate(files, opts.offset, opts.headLimit);
    return { rendered: page.join("\n"), unitTotal: files.length, shownUnits: page.length };
  }

  if (mode === "count") {
    const counts = new Map<string, number>();
    for (const m of matches) {
      if (m.kind !== "match") continue;
      const f = displayPath(m.file, config.workspaceRoot);
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    const entries = [...counts.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([f, c]) => `${f}:${c}`);
    const page = paginate(entries, opts.offset, opts.headLimit);
    return { rendered: page.join("\n"), unitTotal: entries.length, shownUnits: page.length };
  }

  return formatContent(matches, config, opts);
}

function formatContent(matches: Match[], config: ServerConfig, opts: ContextOpts): Formatted {
  const rows = matches
    .map((m) => ({ ...m, f: displayPath(m.file, config.workspaceRoot) }))
    .sort((a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : a.lineNumber - b.lineNumber));

  const anchors = rows.filter((r) => r.kind === "match");
  const pageAnchors = paginate(anchors, opts.offset, opts.headLimit);

  const keep = new Set<string>();
  for (const a of pageAnchors) {
    const endLine = a.lineNumber + countNewlines(a.text);
    keep.add(`${a.f}\0${a.lineNumber}`);
    for (let d = 1; d <= opts.before; d++) keep.add(`${a.f}\0${a.lineNumber - d}`);
    for (let d = 1; d <= opts.after; d++) keep.add(`${a.f}\0${endLine + d}`);
  }

  const hasContext = opts.before > 0 || opts.after > 0;
  const out: string[] = [];
  let prevFile: string | null = null;
  let prevLine = -2;
  for (const r of rows) {
    if (!keep.has(`${r.f}\0${r.lineNumber}`)) continue;
    if (hasContext && prevFile !== null && (r.f !== prevFile || r.lineNumber > prevLine + 1)) {
      if (out.length > 0) out.push("--");
    }
    const sep = r.kind === "match" ? ":" : "-";
    out.push(`${r.f}${sep}${r.lineNumber}${sep}${r.text}`);
    prevFile = r.f;
    prevLine = r.lineNumber + countNewlines(r.text);
  }
  return { rendered: out.join("\n"), unitTotal: anchors.length, shownUnits: pageAnchors.length };
}

function composeResult(
  rendered: string,
  config: ServerConfig,
  state: { truncated: boolean; unitTotal: number; shownUnits: number; offset: number },
): string {
  const { truncated, unitTotal, shownUnits, offset } = state;
  const bounded = bound(rendered, config.maxOutputBytes);

  if (truncated) {
    const warning =
      "[... search incomplete: the scan hit its output cap; some matching files were not scanned. " +
      "Narrow the pattern, path, or glob for complete results. ...]";
    if (unitTotal === 0) return warning;
    return `${bounded}\n${warning}`;
  }

  if (unitTotal === 0) return bounded;

  if (offset >= unitTotal) {
    return `(no results at offset ${offset}; ${unitTotal} total)`;
  }

  if (Buffer.byteLength(rendered, "utf8") > config.maxOutputBytes) {
    return `${bounded}\n[... page exceeded ${config.maxOutputBytes} bytes and was cut; set or reduce head_limit to page in smaller chunks ...]`;
  }

  const nextOffset = offset + shownUnits;
  if (nextOffset < unitTotal) {
    return `${bounded}\n[... showing ${offset}..${nextOffset} of ${unitTotal}; call again with offset=${nextOffset} for more ...]`;
  }

  return bounded;
}
