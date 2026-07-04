import { checkSyntaxText, grammarForPath } from "./treesitter.js";

export const ANNOTATE_MAX_BYTES = 1_000_000;
export const ANNOTATE_TIMEOUT_MS = 1000;
export const ANNOTATE_MAX_FILES = 5;

interface AnnotateConfig {
  treeSitterAvailable: boolean;
}

export async function syntaxWarning(
  display: string,
  content: string,
  config: AnnotateConfig,
): Promise<string> {
  try {
    if (!config.treeSitterAvailable) return "";
    const grammar = grammarForPath(display);
    if (!grammar) return "";
    if (Buffer.byteLength(content, "utf8") > ANNOTATE_MAX_BYTES) return "";
    const outcome = await checkSyntaxText(content, grammar, {
      timeoutMs: ANNOTATE_TIMEOUT_MS,
      maxIssues: 1,
    });
    if (typeof outcome === "string" || outcome.ok) return "";
    const issue = outcome.errors[0];
    if (!issue) return "";
    const detail =
      issue.kind === "missing" ? `missing \`${issue.near}\`` : `near \`${issue.near}\``;
    return (
      `\nwarning: ${grammar} syntax error in ${display} at line ${issue.line}, ` +
      `column ${issue.column} (${detail}); run check_syntax for details.`
    );
  } catch {
    return "";
  }
}

export async function syntaxWarnings(
  files: Array<{ rel: string; text: string }>,
  config: AnnotateConfig,
  maxChecks = ANNOTATE_MAX_FILES,
): Promise<string> {
  if (!config.treeSitterAvailable) return "";
  let out = "";
  let checks = 0;
  for (const file of files) {
    if (checks >= maxChecks) break;
    if (!grammarForPath(file.rel)) continue;
    checks++;
    out += await syntaxWarning(file.rel, file.text, config);
  }
  return out;
}
