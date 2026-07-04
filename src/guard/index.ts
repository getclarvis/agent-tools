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
} from "./types.js";
export { analyzeBash } from "./analyze-bash.js";
export { buildGuardContext } from "./context.js";
export { withinWorkspace, touchesOutside, commandsIn } from "./helpers.js";
