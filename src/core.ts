import { createRequire } from "node:module";
import type { ValidateFunction } from "ajv";
import { ToolError, serializeError } from "./errors.js";
import { bound } from "./lib/output.js";
import { tools, getTool, selectSurface } from "./tools/registry.js";
import { textPart, type ContentPart, type ToolResult } from "./tools/content.js";
import { buildGuardContext } from "./guard/context.js";
import type { ElicitRequest } from "./guard/types.js";
import type { ServerConfig } from "./config.js";

interface AjvInstance {
  compile(schema: unknown): ValidateFunction;
  errorsText(errors?: unknown, opts?: { separator?: string }): string;
}

interface AjvModule {
  default: new (opts?: Record<string, unknown>) => AjvInstance;
}

const Ajv = (createRequire(import.meta.url)("ajv") as AjvModule).default;

const ajv = new Ajv({ allErrors: true, useDefaults: true, coerceTypes: true });
const validators = new Map<string, ValidateFunction>();
for (const tool of tools) {
  validators.set(tool.name, ajv.compile(tool.inputSchema));
}

export interface DispatchResult {
  isError: boolean;
  content: ContentPart[];
  meta?: Record<string, unknown>;
}

function normalizeOutput(out: string | ToolResult): ToolResult {
  return typeof out === "string" ? { content: out } : out;
}

function errorResult(err: unknown): DispatchResult {
  return { isError: true, content: [textPart(serializeError(err))] };
}

function boundParts(
  parts: ContentPart[],
  bounded: boolean | undefined,
  maxOutputBytes: number,
): ContentPart[] {
  if (bounded) return parts;
  return parts.map((p) => (p.type === "text" ? textPart(bound(p.text, maxOutputBytes)) : p));
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function listTools(config: ServerConfig): ToolInfo[] {
  return selectSurface(config.readOnly, config.treeSitterAvailable).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

async function applyGuard(
  name: string,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<DispatchResult | null> {
  if (!config.guard) return null;
  try {
    const ctx = buildGuardContext(name, args, config);
    const decision = await config.guard(ctx);
    if (decision.verdict === "allow") return null;
    const reason = decision.reason ?? "blocked by guard";
    if (decision.verdict === "deny") return errorResult(new ToolError("denied", reason));
    if (!config.elicit) return errorResult(new ToolError("denied", reason));
    const req: ElicitRequest = { tool: name, args, reason: decision.reason, bash: ctx.bash };
    const allowed = await config.elicit(req);
    return allowed ? null : errorResult(new ToolError("denied", reason));
  } catch (err) {
    return errorResult(err);
  }
}

export async function dispatch(
  name: string,
  args: Record<string, unknown>,
  config: ServerConfig,
  signal?: AbortSignal,
): Promise<DispatchResult> {
  const tool = getTool(name, selectSurface(config.readOnly, config.treeSitterAvailable));
  if (!tool) {
    return errorResult(new ToolError("not_found", `Unknown tool: ${name}`));
  }

  const validate = validators.get(name)!;
  const filled = structuredClone(args);
  if (!validate(filled)) {
    const detail = ajv.errorsText(validate.errors, { separator: "; " });
    return errorResult(new ToolError("invalid_input", detail || "invalid arguments"));
  }

  const gate = await applyGuard(name, filled, config);
  if (gate) return gate;

  try {
    const { content, meta } = normalizeOutput(await tool.handler(filled, config, signal));
    const parts = typeof content === "string" ? [textPart(content)] : content;
    return {
      isError: false,
      content: boundParts(parts, tool.bounded, config.maxOutputBytes),
      ...(meta ? { meta } : {}),
    };
  } catch (err) {
    return errorResult(err);
  }
}
