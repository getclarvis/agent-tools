import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

export interface ServerConfig {
  workspaceRoot: string;

  maxOutputBytes: number;

  maxFileBytes: number;

  bashTimeoutMs: number;

  bashTimeoutMaxMs: number;

  ripgrepAvailable: boolean;

  readOnly: boolean;

  confineToWorkspace: boolean;
}

export const DEFAULT_MAX_OUTPUT_BYTES = 131072;
export const DEFAULT_MAX_FILE_BYTES = 20_000_000;
export const DEFAULT_BASH_TIMEOUT_MS = 120000;
export const DEFAULT_BASH_TIMEOUT_MAX_MS = 600000;
const MIN_OUTPUT_BYTES = 1024;
const MIN_FILE_BYTES = 1024;

export class StartupError extends Error {}

function parseWorkspaceArg(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--workspace") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new StartupError("--workspace requires a path argument");
      }
      return value;
    }
    if (arg.startsWith("--workspace=")) {
      const value = arg.slice("--workspace=".length);
      if (value === "") throw new StartupError("--workspace requires a path argument");
      return value;
    }
  }
  return undefined;
}

const BOOL_TRUE = new Set(["1", "true", "yes", "on"]);
const BOOL_FALSE = new Set(["0", "false", "no", "off", ""]);

function resolveReadOnly(argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (argv.includes("--read-only")) return true;
  const raw = env.READ_ONLY;
  if (raw === undefined) return false;
  const norm = raw.trim().toLowerCase();
  if (BOOL_TRUE.has(norm)) return true;
  if (BOOL_FALSE.has(norm)) return false;
  throw new StartupError(`READ_ONLY must be one of 1/true/yes/on or 0/false/no/off, got: ${raw}`);
}

function resolveConfine(argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (argv.includes("--allow-outside-workspace")) return false;
  const raw = env.ALLOW_OUTSIDE_WORKSPACE;
  if (raw === undefined) return true;
  const norm = raw.trim().toLowerCase();
  if (BOOL_TRUE.has(norm)) return false;
  if (BOOL_FALSE.has(norm)) return true;
  throw new StartupError(
    `ALLOW_OUTSIDE_WORKSPACE must be one of 1/true/yes/on or 0/false/no/off, got: ${raw}`,
  );
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
  min = 1,
): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) {
    throw new StartupError(`${name} must be a positive integer, got: ${value}`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min) {
    throw new StartupError(`${name} must be an integer >= ${min}, got: ${value}`);
  }
  return n;
}

function probeRipgrep(): boolean {
  try {
    const res = spawnSync("rg", ["--version"], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

function validateWorkspace(rawRoot: string): string {
  const workspaceRoot = path.resolve(rawRoot);
  let stat;
  try {
    stat = statSync(workspaceRoot);
  } catch {
    throw new StartupError(`Workspace root does not exist: ${workspaceRoot}`);
  }
  if (!stat.isDirectory()) {
    throw new StartupError(`Workspace root is not a directory: ${workspaceRoot}`);
  }
  return workspaceRoot;
}

function requireMin(n: number, min: number, name: string): number {
  if (!Number.isSafeInteger(n) || n < min) {
    throw new StartupError(`${name} must be an integer >= ${min}, got: ${String(n)}`);
  }
  return n;
}

function assertTimeoutOrder(min: number, max: number, minLabel: string, maxLabel: string): void {
  if (max < min) {
    throw new StartupError(`${maxLabel} (${max}) must be >= ${minLabel} (${min}).`);
  }
}

export interface AgentToolsOptions {
  workspaceRoot: string;

  readOnly?: boolean;

  confineToWorkspace?: boolean;

  maxOutputBytes?: number;

  maxFileBytes?: number;

  bashTimeoutMs?: number;

  bashTimeoutMaxMs?: number;

  probeRipgrep?: () => boolean;
}

export function resolveConfig(options: AgentToolsOptions): ServerConfig {
  if (!options.workspaceRoot) {
    throw new StartupError("No workspace root: options.workspaceRoot is required.");
  }
  const workspaceRoot = validateWorkspace(options.workspaceRoot);

  const bashTimeoutMs = requireMin(
    options.bashTimeoutMs ?? DEFAULT_BASH_TIMEOUT_MS,
    1,
    "bashTimeoutMs",
  );
  const bashTimeoutMaxMs = requireMin(
    options.bashTimeoutMaxMs ?? DEFAULT_BASH_TIMEOUT_MAX_MS,
    1,
    "bashTimeoutMaxMs",
  );
  assertTimeoutOrder(bashTimeoutMs, bashTimeoutMaxMs, "bashTimeoutMs", "bashTimeoutMaxMs");

  return {
    workspaceRoot,
    maxOutputBytes: requireMin(
      options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      MIN_OUTPUT_BYTES,
      "maxOutputBytes",
    ),
    maxFileBytes: requireMin(
      options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      MIN_FILE_BYTES,
      "maxFileBytes",
    ),
    bashTimeoutMs,
    bashTimeoutMaxMs,
    ripgrepAvailable: (options.probeRipgrep ?? probeRipgrep)(),
    readOnly: options.readOnly ?? false,
    confineToWorkspace: options.confineToWorkspace ?? true,
  };
}

export function buildConfig(
  argv: string[],
  env: NodeJS.ProcessEnv,
  probe: () => boolean = probeRipgrep,
): ServerConfig {
  const rawRoot = parseWorkspaceArg(argv) ?? env.WORKSPACE_ROOT;
  if (!rawRoot) {
    throw new StartupError("No workspace root: pass --workspace <path> or set WORKSPACE_ROOT.");
  }

  const bashTimeoutMs = parsePositiveInt(
    env.BASH_TIMEOUT_MS,
    DEFAULT_BASH_TIMEOUT_MS,
    "BASH_TIMEOUT_MS",
  );
  const bashTimeoutMaxMs = parsePositiveInt(
    env.BASH_TIMEOUT_MAX_MS,
    DEFAULT_BASH_TIMEOUT_MAX_MS,
    "BASH_TIMEOUT_MAX_MS",
  );
  assertTimeoutOrder(bashTimeoutMs, bashTimeoutMaxMs, "BASH_TIMEOUT_MS", "BASH_TIMEOUT_MAX_MS");

  return resolveConfig({
    workspaceRoot: rawRoot,
    maxOutputBytes: parsePositiveInt(
      env.MAX_OUTPUT_BYTES,
      DEFAULT_MAX_OUTPUT_BYTES,
      "MAX_OUTPUT_BYTES",
      MIN_OUTPUT_BYTES,
    ),
    maxFileBytes: parsePositiveInt(
      env.MAX_FILE_BYTES,
      DEFAULT_MAX_FILE_BYTES,
      "MAX_FILE_BYTES",
      MIN_FILE_BYTES,
    ),
    bashTimeoutMs,
    bashTimeoutMaxMs,
    readOnly: resolveReadOnly(argv, env),
    confineToWorkspace: resolveConfine(argv, env),
    probeRipgrep: probe,
  });
}
