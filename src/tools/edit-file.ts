import { ToolError } from "../errors.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import { writeAtomic, withFileLock } from "../lib/atomic.js";
import { reencode } from "../lib/text.js";
import { readTextFile } from "../lib/textfile.js";
import { findCascadeMatch, scanLineBlocks, trimEnds } from "../lib/match-cascade.js";
import type { ServerConfig } from "../config.js";
import type { ToolDef } from "./types.js";

export async function editFileLocked(
  target: string,
  relPath: string,
  config: ServerConfig,
  transform: (content: string) => string,
  message: (rel: string) => string,
): Promise<string> {
  return withFileLock(target, async () => {
    const decoded = await readTextFile(target, relPath, config.maxFileBytes);
    if (decoded.encoding !== "utf8") {
      throw new ToolError(
        "is_binary",
        `Editing ${decoded.encoding} files is not supported (the file would be rewritten as ` +
          `UTF-8): ${relPath}`,
        { path: relPath, encoding: decoded.encoding },
      );
    }
    const newText = transform(decoded.content);
    await writeAtomic(target, reencode(newText, decoded));
    return message(displayPath(target, config.workspaceRoot));
  });
}

export interface EditSpec {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function occurrenceLines(text: string, needle: string, cap = 20): number[] {
  const lines: number[] = [];
  let idx = text.indexOf(needle);
  while (idx !== -1 && lines.length < cap) {
    lines.push(text.slice(0, idx).split("\n").length);
    idx = text.indexOf(needle, idx + needle.length);
  }
  return lines;
}

function diagnoseNoMatch(text: string, needle: string): string {
  if (needle === "") return "";
  const destripped = needle
    .split("\n")
    .map((l) => l.replace(/^\s*\d+\t/, ""))
    .join("\n");
  if (destripped !== needle && destripped !== "" && text.includes(destripped)) {
    return (
      " It looks like old_string still contains read_file's line-number prefixes " +
      '(e.g. "   12\\t"): drop them so old_string is only the file\'s own text.'
    );
  }

  const hay = text.split("\n");
  const need = needle.split("\n").map(trimEnds);
  const hits = scanLineBlocks(hay, need, (a, b) => trimEnds(a) === b, 6).map((i) => i + 1);
  if (hits.length > 0) {
    const shown = hits.slice(0, 5).join(", ");
    const where =
      hits.length === 1 ? `line ${shown}` : `lines ${shown}${hits.length > 5 ? ", …" : ""}`;
    return (
      ` The text is present at ${where} but its leading/trailing whitespace differs from ` +
      "old_string. Re-read that region with read_file and copy the indentation verbatim."
    );
  }
  return "";
}

export function applyEdit(
  text: string,
  spec: EditSpec,
): { text: string; count: number; fuzzy: boolean } {
  if (spec.old_string === spec.new_string) {
    throw new ToolError(
      "invalid_input",
      "old_string and new_string are identical — nothing to change.",
    );
  }
  const count = countOccurrences(text, spec.old_string);
  if (count === 0) {
    if (!spec.replace_all) {
      const m = findCascadeMatch(text, spec.old_string);
      if (m && m.spans.length === 1) {
        const { start, end } = m.spans[0]!;
        return {
          text: text.slice(0, start) + spec.new_string + text.slice(end),
          count: 1,
          fuzzy: true,
        };
      }
      if (m) {
        const lines = m.spans.map((s) => text.slice(0, s.start).split("\n").length);
        throw new ToolError(
          "ambiguous_match",
          `old_string was not found exactly; after whitespace-tolerant matching it matched ` +
            `${m.spans.length} regions (at lines ${lines.join(", ")}); it must be unique. Add ` +
            "surrounding lines, or correct the whitespace so it matches one region exactly.",
          { lines },
        );
      }
    }
    throw new ToolError(
      "no_match",
      "old_string not found. It must match the file byte-for-byte (whitespace, " +
        "indentation, and line breaks included) and must NOT include the line-number " +
        "prefixes shown by read_file. Re-read the exact region and copy the text verbatim." +
        diagnoseNoMatch(text, spec.old_string),
    );
  }
  if (count > 1 && !spec.replace_all) {
    const lines = occurrenceLines(text, spec.old_string);
    const at =
      lines.length > 0
        ? ` (at line${lines.length === 1 ? "" : "s"} ${lines.join(", ")}${count > lines.length ? ", …" : ""})`
        : "";
    throw new ToolError(
      "ambiguous_match",
      `old_string matched ${count} times${at}; it must be unique. Add surrounding lines to ` +
        "make the match unique, or pass replace_all: true to replace every occurrence.",
    );
  }
  if (spec.replace_all) {
    return { text: text.split(spec.old_string).join(spec.new_string), count, fuzzy: false };
  }
  const idx = text.indexOf(spec.old_string);
  return {
    text: text.slice(0, idx) + spec.new_string + text.slice(idx + spec.old_string.length),
    count: 1,
    fuzzy: false,
  };
}

export const editFile: ToolDef = {
  name: "edit_file",
  description:
    "Replace one exact occurrence of `old_string` with `new_string` in a file. `old_string` is " +
    "matched LITERALLY (not a regex), exactly as read_file shows the text — including whitespace, " +
    "indentation, and line breaks — but WITHOUT read_file's line-number/tab prefixes. The match " +
    "MUST be unique: if it appears more than once the call fails (`ambiguous_match`) unless " +
    "`replace_all` is set; if not found it fails (`no_match`). On failure, re-read the region and " +
    "copy more surrounding lines verbatim, or set replace_all. For several edits to ONE file use " +
    "multi_edit; to change MANY files use apply_patch.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "File to edit. Relative to workspace root or absolute. Must already exist and be text " +
          "(binary is rejected).",
      },
      old_string: {
        type: "string",
        minLength: 1,
        description:
          "Exact text to find. Copy it verbatim from read_file output with the line-number/tab " +
          "prefix removed; whitespace, indentation, and newlines must match. Not a regex.",
      },
      new_string: {
        type: "string",
        description:
          "Replacement text. May be empty to delete the matched text. Must differ from old_string.",
      },
      replace_all: {
        type: "boolean",
        default: false,
        description:
          "Replace every occurrence instead of requiring a single unique match. Default false.",
      },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const target = resolvePath(
      args.path as string,
      config.workspaceRoot,
      config.confineToWorkspace,
    );
    let count = 0;
    let fuzzy = false;
    return editFileLocked(
      target,
      args.path as string,
      config,
      (content) => {
        const r = applyEdit(content, {
          old_string: args.old_string as string,
          new_string: args.new_string as string,
          replace_all: args.replace_all as boolean,
        });
        count = r.count;
        fuzzy = r.fuzzy;
        return r.text;
      },
      (rel) =>
        fuzzy
          ? `Replaced 1 occurrence in ${rel} (matched after whitespace-tolerant search; ` +
            "verify the result)."
          : `Replaced ${count} ${count === 1 ? "occurrence" : "occurrences"} in ${rel}.`,
    );
  },
};
