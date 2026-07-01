import { createRequire } from "node:module";
import type { ValidateFunction } from "ajv";
import { ToolError, serializeError } from "./errors.js";
import { bound } from "./lib/output.js";
import { tools, getTool, selectSurface } from "./tools/registry.js";
import type { ServerConfig } from "./config.js";

interface AjvInstance {
  compile(schema: unknown): ValidateFunction;
  errorsText(errors?: unknown, opts?: { separator?: string }): string;
}

interface AjvModule {
  default: new (opts?: Record<string, unknown>) => AjvInstance;
}

const Ajv = (createRequire(import.meta.url)("ajv") as AjvModule).default;

const ajv = new Ajv({ allErrors: true, useDefaults: true });
const validators = new Map<string, ValidateFunction>();
for (const tool of tools) {
  validators.set(tool.name, ajv.compile(tool.inputSchema));
}

export interface DispatchResult {
  isError: boolean;
  text: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function listTools(config: ServerConfig): ToolInfo[] {
  return selectSurface(config.readOnly).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export async function dispatch(
  name: string,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<DispatchResult> {
  const tool = getTool(name, selectSurface(config.readOnly));
  if (!tool) {
    return {
      isError: true,
      text: serializeError(new ToolError("not_found", `Unknown tool: ${name}`)),
    };
  }

  const validate = validators.get(name)!;
  if (!validate(args)) {
    const detail = ajv.errorsText(validate.errors, { separator: "; " });
    return {
      isError: true,
      text: serializeError(new ToolError("invalid_input", detail || "invalid arguments")),
    };
  }

  try {
    const text = await tool.handler(args, config);
    return { isError: false, text: tool.bounded ? text : bound(text, config.maxOutputBytes) };
  } catch (err) {
    return { isError: true, text: serializeError(err) };
  }
}
