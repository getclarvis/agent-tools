import type { ServerConfig } from "../config.js";
import type { ToolResult } from "./content.js";

export interface ToolDef {
  name: string;
  description: string;

  inputSchema: Record<string, unknown>;

  bounded?: boolean;

  handler: (
    args: Record<string, unknown>,
    config: ServerConfig,
    signal?: AbortSignal,
  ) => Promise<string | ToolResult>;
}
