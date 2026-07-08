import { promises as fs } from "node:fs";
import { ToolError, fsError } from "../errors.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import { writeAtomic, withFileLock } from "../lib/atomic.js";
import { readTextFile } from "../lib/textfile.js";
import { syntaxWarning } from "../lib/syntax-annotate.js";
import { unifiedDiff } from "../lib/unified-diff.js";
import type { ToolDef } from "./types.js";

export const writeFile: ToolDef = {
  name: "write_file",
  description:
    "Create or completely overwrite a file with `content`, creating missing parent directories. " +
    "Writes `content` verbatim (no trailing newline added or stripped). Use ONLY to create a new " +
    "file or fully replace one; to change part of an existing file use edit_file or multi_edit so " +
    "you do not lose the rest.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Destination file. Relative to workspace root or absolute (~ is not expanded). An " +
          "existing file is overwritten; missing parent directories are created.",
      },
      content: {
        type: "string",
        description: "Full file content. Replaces any existing content in its entirety.",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const relPath = args.path as string;
    const target = resolvePath(relPath, config.workspaceRoot, config.confineToWorkspace);
    const content = args.content as string;

    return withFileLock(target, async () => {
      let existed = false;
      try {
        const stat = await fs.stat(target);
        if (stat.isDirectory()) {
          throw new ToolError("not_a_file", `Path is a directory: ${relPath}`, { path: relPath });
        }
        existed = true;
      } catch (err) {
        if (err instanceof ToolError) throw err;
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "ENOENT") throw fsError(e, relPath);
      }

      let before: string | undefined;
      if (existed) {
        try {
          const prior = await readTextFile(target, relPath, config.maxFileBytes);
          if (prior.encoding === "utf8") before = prior.content;
        } catch {
          before = undefined;
        }
      }

      try {
        await writeAtomic(target, content);
      } catch (err) {
        if (err instanceof ToolError) throw err;
        throw fsError(err as NodeJS.ErrnoException, relPath);
      }

      const bytes = Buffer.byteLength(content, "utf8");
      const rel = displayPath(target, config.workspaceRoot);
      const text =
        `Wrote ${bytes} bytes to ${rel} (${existed ? "overwritten" : "created"}).` +
        (await syntaxWarning(rel, content, config));
      const diff = before !== undefined ? unifiedDiff(rel, before, content) : undefined;
      return diff ? { content: text, meta: { diff } } : { content: text };
    });
  },
};
