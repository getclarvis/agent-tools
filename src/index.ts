import { resolveConfig } from "./config.js";
import { dispatch, listTools } from "./core.js";
import type { AgentToolsOptions, ServerConfig } from "./config.js";
import type { DispatchResult, ToolInfo } from "./core.js";

export interface AgentTools {
  readonly config: ServerConfig;

  listTools(): ToolInfo[];

  callTool(name: string, args?: Record<string, unknown>): Promise<DispatchResult>;
}

export function createAgentTools(options: AgentToolsOptions): AgentTools {
  const config = resolveConfig(options);
  return {
    config,
    listTools: () => listTools(config),
    callTool: (name, args = {}) => dispatch(name, args, config),
  };
}

export { dispatch, listTools } from "./core.js";
export type { DispatchResult, ToolInfo } from "./core.js";

export {
  resolveConfig,
  buildConfig,
  StartupError,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_BASH_TIMEOUT_MS,
  DEFAULT_BASH_TIMEOUT_MAX_MS,
  DEFAULT_MONITOR_READY_TIMEOUT_MS,
  DEFAULT_MAX_MONITORS,
} from "./config.js";
export type { ServerConfig, AgentToolsOptions } from "./config.js";

export { tools, readOnlyTools, getTool, selectSurface } from "./tools/registry.js";
export type { ToolDef } from "./tools/types.js";

export {
  analyzeBash,
  buildGuardContext,
  withinWorkspace,
  touchesOutside,
  commandsIn,
} from "./guard/index.js";
export type {
  Verdict,
  GuardDecision,
  Segment,
  BashFacts,
  PathFact,
  GuardContext,
  Guard,
  ElicitRequest,
  Elicit,
} from "./guard/index.js";
export type { ContentPart, TextPart, ImagePart, ToolResult } from "./tools/content.js";
export { contentText } from "./tools/content.js";

export { ToolError, serializeError, fsError } from "./errors.js";
export type { ErrorCode } from "./errors.js";

export { sweepSpillDir } from "./lib/output.js";
export { sweepMonitors } from "./lib/monitor.js";

export { setWarnSink } from "./lib/log.js";
export type { WarnSink } from "./lib/log.js";
