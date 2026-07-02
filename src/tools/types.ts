import type { ServerConfig } from "../config.js";

export interface ToolDef {
  name: string;
  description: string;

  inputSchema: Record<string, unknown>;

  bounded?: boolean;

  handler: (
    args: Record<string, unknown>,
    config: ServerConfig,
    signal?: AbortSignal,
  ) => Promise<string>;
}
