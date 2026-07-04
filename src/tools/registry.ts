import { readFile } from "./read-file.js";
import { readImage } from "./read-image.js";
import { readFiles } from "./read-files.js";
import { writeFile } from "./write-file.js";
import { editFile } from "./edit-file.js";
import { multiEdit } from "./multi-edit.js";
import { applyPatchTool } from "./apply-patch.js";
import { replace } from "./replace.js";
import { listDir } from "./list-dir.js";
import { globTool } from "./glob.js";
import { grep } from "./grep.js";
import { diffTool } from "./diff.js";
import { bash } from "./bash.js";
import { monitorStart, monitorPoll, monitorStop, monitorList } from "./monitor.js";
import { move } from "./move.js";
import { copy } from "./copy.js";
import { mkdir } from "./mkdir.js";
import { remove } from "./remove.js";
import { fileStat } from "./file-stat.js";
import { tree } from "./tree.js";
import { outline } from "./outline.js";
import { checkSyntax } from "./check-syntax.js";
import type { ToolDef } from "./types.js";

export const tools: ToolDef[] = [
  readFile,
  readImage,
  readFiles,
  writeFile,
  editFile,
  multiEdit,
  applyPatchTool,
  replace,
  listDir,
  globTool,
  grep,
  diffTool,
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
  outline,
  checkSyntax,
];

export const readOnlyTools: ToolDef[] = [
  readFile,
  readImage,
  readFiles,
  listDir,
  globTool,
  grep,
  diffTool,
  fileStat,
  tree,
  outline,
  checkSyntax,
];

const SYNTAX_TOOLS = new Set(["outline", "check_syntax"]);

export function selectSurface(readOnly: boolean, treeSitterAvailable = true): ToolDef[] {
  const base = readOnly ? readOnlyTools : tools;
  return treeSitterAvailable ? base : base.filter((t) => !SYNTAX_TOOLS.has(t.name));
}

export function getTool(name: string, surface: ToolDef[] = tools): ToolDef | undefined {
  return surface.find((t) => t.name === name);
}
