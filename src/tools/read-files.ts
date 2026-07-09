import { ToolError } from "../errors.js";
import { resolvePath } from "../lib/paths.js";
import { renderNumberedSlice } from "../lib/render-lines.js";
import { splitLines } from "../lib/text.js";
import { readTextFile } from "../lib/textfile.js";
import type { ToolDef } from "./types.js";

const MAX_PATHS = 64;

export const readFiles: ToolDef = {
  name: "read_files",
  description:
    "Read several UTF-8 text files in one call, each returned with 1-indexed line-number prefixes " +
    "under a `==> <path> <==` header. Use this instead of many read_file calls when you already " +
    "know the paths. A path that is missing, binary, a directory, or too large yields an error line " +
    "for that entry without failing the others. The combined output is capped; later files are " +
    "dropped if the budget runs out — read the biggest ones with read_file instead. Binary files " +
    "are rejected per entry.",
  bounded: true,
  inputSchema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: MAX_PATHS,
        description:
          "Files to read, in order. Each relative to workspace root or absolute (~ is not expanded).",
      },
    },
    required: ["paths"],
  },
  async handler(args, config) {
    const paths = args.paths as string[];
    const sections: string[] = [];
    let remaining = config.maxOutputBytes;
    let stoppedAt = -1;

    for (let idx = 0; idx < paths.length; idx++) {
      const rel = paths[idx] as string;
      if (remaining <= 0) {
        stoppedAt = idx;
        break;
      }

      let section: string;
      try {
        const target = resolvePath(rel, config.workspaceRoot, config.confineToWorkspace);
        const text = (await readTextFile(target, rel, config.maxFileBytes)).content;
        const header = `==> ${rel} <==`;
        if (text === "") {
          section = `${header}\n(empty file)`;
        } else {
          const lines = splitLines(text);
          const budget = remaining - Buffer.byteLength(header, "utf8") - 1;
          const { body, shownLines, byteCapped } = renderNumberedSlice(
            lines,
            0,
            lines.length,
            budget,
          );
          section = `${header}\n${body}`;
          if (byteCapped) {
            section +=
              `\n[... ${shownLines} of ${lines.length} lines shown; ` +
              `use read_file for the rest ...]`;
          }
        }
      } catch (err) {
        if (!(err instanceof ToolError)) throw err;
        section = `==> ${rel} — ${err.code}: ${err.message} <==`;
      }

      sections.push(section);
      remaining -= Buffer.byteLength(section, "utf8") + 2;
    }

    if (stoppedAt >= 0) {
      const omitted = paths.length - stoppedAt;
      sections.push(
        `[... ${omitted} more file(s) not shown; call read_files with fewer paths ...]`,
      );
    }

    return sections.join("\n\n");
  },
};
