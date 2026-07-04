import { readFile } from "./read-file.js";
import { readImage } from "./read-image.js";
import { writeFile } from "./write-file.js";
import { editFile } from "./edit-file.js";
import { multiEdit } from "./multi-edit.js";
import { applyPatchTool } from "./apply-patch.js";
import { listDir } from "./list-dir.js";
import { globTool } from "./glob.js";
import { grep } from "./grep.js";
import { bash } from "./bash.js";
import { monitorStart, monitorPoll, monitorStop, monitorList } from "./monitor.js";
import { move } from "./move.js";
import { copy } from "./copy.js";
import { mkdir } from "./mkdir.js";
import { remove } from "./remove.js";
import { fileStat } from "./file-stat.js";
import { tree } from "./tree.js";
import type { ToolDef } from "./types.js";

export const tools: ToolDef[] = [
  readFile,
  readImage,
  writeFile,
  editFile,
  multiEdit,
  applyPatchTool,
  listDir,
  globTool,
  grep,
  bash,
  monitorStart,
  monitorPoll,
  monitorStop,
  monitorList,
  move,
  copy,
  mkdir,
  remove,
  fileStat,
  tree,
];

export const readOnlyTools: ToolDef[] = [
  readFile,
  readImage,
  listDir,
  globTool,
  grep,
  fileStat,
  tree,
];

export function selectSurface(readOnly: boolean): ToolDef[] {
  return readOnly ? readOnlyTools : tools;
}

export function getTool(name: string, surface: ToolDef[] = tools): ToolDef | undefined {
  return surface.find((t) => t.name === name);
}
