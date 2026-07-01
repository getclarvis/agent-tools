import { ToolError } from "../errors.js";
import { resolvePath } from "../lib/paths.js";
import { splitLines } from "../lib/text.js";
import { readTextFile } from "../lib/textfile.js";
import type { ToolDef } from "./types.js";

const MAX_LINE = 2000;
const DEFAULT_LIMIT = 2000;
const LINE_TRUNC = " [... line truncated ...]";

function capBytes(content: string, maxBytes: number): string {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) return content;
  const room = Math.max(0, maxBytes - Buffer.byteLength(LINE_TRUNC, "utf8"));
  const buf = Buffer.from(content, "utf8");
  let end = Math.min(room, buf.length);
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf8") + LINE_TRUNC;
}

export const readFile: ToolDef = {
  name: "read_file",
  description:
    "Read a UTF-8 text file, returned with 1-indexed line-number prefixes (like `cat -n`). Reads " +
    "up to 2000 lines from `offset`; if more remain, a footer gives the next `offset` to continue " +
    "from. NEVER use to search large files for a string — use grep. If you do not know the path, " +
    "use glob or list_dir first. Binary files are rejected.",
  bounded: true,
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File to read. Relative to workspace root or absolute (~ is not expanded).",
      },
      offset: {
        type: "integer",
        description:
          "1-indexed first line to read. Default 1. A negative value counts from the end (e.g. " +
          "-10 reads the last 10 lines); 0 is invalid. A positive offset must be <= the file's " +
          "line count.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        description:
          "Max number of lines to return. Default 2000. Page through a long file by repeating " +
          "with offset advanced per the footer.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const relPath = args.path as string;
    const target = resolvePath(relPath, config.workspaceRoot, config.confineToWorkspace);
    const offset = (args.offset as number | undefined) ?? 1;
    const limit = (args.limit as number | undefined) ?? DEFAULT_LIMIT;

    const text = (await readTextFile(target, relPath, config.maxFileBytes)).content;

    if (text === "") return "(empty file)";
    const lines = splitLines(text);
    const total = lines.length;

    if (offset === 0) {
      throw new ToolError(
        "invalid_input",
        "offset must be non-zero: use a positive 1-indexed line, or a negative tail offset.",
        { path: relPath },
      );
    }
    let start1: number;
    if (offset < 0) {
      start1 = Math.max(1, total + offset + 1);
    } else {
      if (total > 0 && offset > total) {
        throw new ToolError(
          "invalid_input",
          `offset ${offset} exceeds file line count ${total}; read from offset 1..${total}`,
          { path: relPath, line_count: total },
        );
      }
      start1 = offset;
    }

    const start = start1 - 1;
    const hardEnd = Math.min(total, start + limit);
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
      content = capBytes(content, config.maxOutputBytes - Buffer.byteLength(prefix, "utf8") - 1);
      const row = prefix + content;
      const rowBytes = Buffer.byteLength(row, "utf8") + 1;
      if (i > start && used + rowBytes > config.maxOutputBytes) break;
      out.push(row);
      used += rowBytes;
      end = i + 1;
    }

    if (end < total) {
      const shown = end - start;
      out.push(`[... ${shown} of ${total} lines shown; continue with offset=${end + 1} ...]`);
    }
    return out.join("\n");
  },
};
