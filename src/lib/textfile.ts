import { promises as fs } from "node:fs";
import { ToolError } from "../errors.js";
import { isBinary, isUtf16Bom } from "./binary.js";
import { decodeText, type DecodedText } from "./text.js";
import { readRawFile } from "./files.js";

function rejectIfUnreadable(buf: Buffer, relForError: string): void {
  // A UTF-16 (BOM) file legitimately contains NUL bytes; decodeText handles it, so it is not
  // binary. Other NUL-bearing files are refused.
  if (isUtf16Bom(buf)) return;
  if (isBinary(buf)) {
    throw new ToolError("is_binary", `File appears to be binary: ${relForError}`, {
      path: relForError,
    });
  }
}

export async function readTextFile(
  target: string,
  relForError: string,
  maxBytes: number,
): Promise<DecodedText> {
  const buf = await readRawFile(target, relForError, maxBytes, "MAX_FILE_BYTES");
  rejectIfUnreadable(buf, relForError);
  return decodeText(buf);
}

export async function readTextBuffer(
  target: string,
  maxBytes: number,
): Promise<DecodedText | null> {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return null;
  }
  if (stat.size > maxBytes) return null;
  let buf: Buffer;
  try {
    buf = await fs.readFile(target);
  } catch {
    return null;
  }
  if (isBinary(buf)) return null;
  return decodeText(buf);
}
