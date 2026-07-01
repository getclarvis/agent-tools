import { readFile } from "./read-file.js";
import { writeFile } from "./write-file.js";
import { editFile } from "./edit-file.js";
import { multiEdit } from "./multi-edit.js";
import { applyPatchTool } from "./apply-patch.js";
import { listDir } from "./list-dir.js";
import { globTool } from "./glob.js";
import { grep } from "./grep.js";
import { bash } from "./bash.js";
import type { ToolDef } from "./types.js";

export const tools: ToolDef[] = [
  readFile,
  writeFile,
  editFile,
  multiEdit,
  applyPatchTool,
  listDir,
  globTool,
  grep,
  bash,
];

export const readOnlyTools: ToolDef[] = [readFile, listDir, globTool, grep];

export function selectSurface(readOnly: boolean): ToolDef[] {
  return readOnly ? readOnlyTools : tools;
}

export function getTool(name: string, surface: ToolDef[] = tools): ToolDef | undefined {
  return surface.find((t) => t.name === name);
}
