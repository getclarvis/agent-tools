import { createTwoFilesPatch } from "diff";
import { resolvePath, displayPath } from "../lib/paths.js";
import { readTextFile } from "../lib/textfile.js";
import type { ToolDef } from "./types.js";

export const diffTool: ToolDef = {
  name: "diff",
  description:
    "Unified diff between two UTF-8 text files in the workspace, without needing git. Both paths are " +
    "read and compared; the result is a standard unified diff (`--- from`, `+++ to`, `@@` hunks). " +
    "Identical content yields `(no differences)`. Line endings are normalized before comparison. " +
    "Binary or oversized files are rejected.",
  inputSchema: {
    type: "object",
    properties: {
      from: {
        type: "string",
        description:
          "The original (left) file. Relative to workspace root or absolute (~ is not expanded).",
      },
      to: {
        type: "string",
        description:
          "The changed (right) file. Relative to workspace root or absolute (~ is not expanded).",
      },
    },
    required: ["from", "to"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const fromRel = args.from as string;
    const toRel = args.to as string;
    const fromTarget = resolvePath(fromRel, config.workspaceRoot, config.confineToWorkspace);
    const toTarget = resolvePath(toRel, config.workspaceRoot, config.confineToWorkspace);
    const fromContent = (await readTextFile(fromTarget, fromRel, config.maxFileBytes)).content;
    const toContent = (await readTextFile(toTarget, toRel, config.maxFileBytes)).content;

    if (fromContent === toContent) return "(no differences)";

    const fromName = displayPath(fromTarget, config.workspaceRoot);
    const toName = displayPath(toTarget, config.workspaceRoot);
    return createTwoFilesPatch(fromName, toName, fromContent, toContent, undefined, undefined, {
      context: 3,
    });
  },
};
