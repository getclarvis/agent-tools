import type { ServerConfig } from "../config.js";

export type Verdict = "allow" | "deny" | "ask";

export interface GuardDecision {
  verdict: Verdict;
  reason?: string;
}

export interface Segment {
  command: string;
  argv: string[];
  normalized: string;
  decidable: boolean;
}

export interface BashFacts {
  paths: string[];
  segments: Segment[];
  undecidable: boolean;
}

export interface PathFact {
  raw: string;
  resolved: string;
  withinWorkspace: boolean;
}

export interface GuardContext {
  tool: string;
  args: Record<string, unknown>;
  config: ServerConfig;
  paths: PathFact[];
  bash?: BashFacts;
}

export type Guard = (ctx: GuardContext) => GuardDecision | Promise<GuardDecision>;

export interface ElicitRequest {
  tool: string;
  args: Record<string, unknown>;
  reason?: string;
  bash?: BashFacts;
}

export type Elicit = (req: ElicitRequest) => boolean | Promise<boolean>;
