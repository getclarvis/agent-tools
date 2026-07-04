import { promises as fs } from "node:fs";
import { ToolError, fsError } from "../errors.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import type { ToolDef } from "./types.js";

export const mkdir: ToolDef = {
  name: "mkdir",
  description:
    "Create a directory, including any missing parent directories (like `mkdir -p`). Idempotent: " +
    "succeeds if the directory already exists. Fails if the path already exists as a file. " +
    "write_file already creates parents for a file, so use this only to create an empty directory.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Directory to create. Relative to workspace root or absolute (~ is not expanded). " +
          "Missing parent directories are created.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const rel = args.path as string;
    const target = resolvePath(rel, config.workspaceRoot, config.confineToWorkspace);

    let firstCreated: string | undefined;
    try {
      firstCreated = await fs.mkdir(target, { recursive: true });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "EEXIST") {
        throw new ToolError("not_a_file", `Path exists and is not a directory: ${rel}`, {
          path: rel,
        });
      }
      throw fsError(e, rel);
    }

    const disp = displayPath(target, config.workspaceRoot);
    return firstCreated === undefined
      ? `Directory already exists: ${disp}.`
      : `Created directory ${disp}.`;
  },
};
