import { warn } from "./lib/log.js";

export type ErrorCode =
  | "invalid_input"
  | "not_found"
  | "not_a_file"
  | "is_binary"
  | "no_match"
  | "ambiguous_match"
  | "patch_failed"
  | "io_error"
  | "timeout"
  | "output_limit"
  | "too_large"
  | "path_escape"
  | "internal";

export class ToolError extends Error {
  readonly code: ErrorCode;
  readonly fields: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, fields: Record<string, unknown> = {}) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.fields = fields;
  }
}

export function serializeError(err: unknown): string {
  if (err instanceof ToolError) {
    return JSON.stringify({ error: err.code, message: err.message, ...err.fields });
  }
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  warn(`clarvis-agent-tools: internal error: ${detail}\n`);
  return JSON.stringify({ error: "internal", message: "internal error" });
}

export function fsError(err: NodeJS.ErrnoException, path: string): ToolError {
  if (err.code === "ENOENT") return new ToolError("not_found", `No such file: ${path}`, { path });
  if (err.code === "EISDIR")
    return new ToolError("not_a_file", `Path is a directory: ${path}`, { path });
  if (err.code === "ENOTDIR")
    return new ToolError("not_a_file", `Not a directory: ${path}`, { path });
  return new ToolError("io_error", `${err.code ?? "EIO"}: ${err.message}`, { path });
}
