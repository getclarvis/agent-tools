import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  chmodSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatch } from "../../src/core.js";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_BASH_TIMEOUT_MS,
  DEFAULT_BASH_TIMEOUT_MAX_MS,
  type ServerConfig,
} from "../../src/config.js";

export function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "clarvis-test-"));
}

export function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

export function makeConfig(root: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    workspaceRoot: root,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxFileBytes: DEFAULT_MAX_FILE_BYTES,
    bashTimeoutMs: DEFAULT_BASH_TIMEOUT_MS,
    bashTimeoutMaxMs: DEFAULT_BASH_TIMEOUT_MAX_MS,
    ripgrepAvailable: false,
    readOnly: false,
    confineToWorkspace: true,
    ...overrides,
  };
}

export interface CallResult {
  isError: boolean;
  text: string;

  json: Record<string, unknown>;
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<CallResult> {
  const r = await dispatch(name, args, config);
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(r.text) as Record<string, unknown>;
  } catch {}
  return { isError: r.isError, text: r.text, json };
}

export function write(root: string, rel: string, content: string): string {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

export function writeBinary(root: string, rel: string): string {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, Buffer.from([0x61, 0x00, 0x62]));
  return p;
}

export function writeUtf16(root: string, rel: string, content: string, be = false): string {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  const buf = Buffer.from("﻿" + content, "utf16le");
  if (be) buf.swap16();
  writeFileSync(p, buf);
  return p;
}

export function read(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

export function exists(root: string, rel: string): boolean {
  return existsSync(path.join(root, rel));
}

export function chmod(root: string, rel: string, mode: number): void {
  chmodSync(path.join(root, rel), mode);
}

export function mode(root: string, rel: string): number {
  return statSync(path.join(root, rel)).mode & 0o777;
}

export const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
