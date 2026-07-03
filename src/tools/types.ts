import type { ServerConfig } from "../config.js";
import type { ContentPart } from "./content.js";

export interface ToolDef {
  name: string;
  description: string;

  inputSchema: Record<string, unknown>;

  bounded?: boolean;

  handler: (
    args: Record<string, unknown>,
    config: ServerConfig,
    signal?: AbortSignal,
  ) => Promise<string | ContentPart[]>;
}
