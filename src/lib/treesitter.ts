import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import path from "node:path";
import { warn } from "./log.js";

const PKG = "@vscode/tree-sitter-wasm";

export const MAX_PARSE_BYTES = 2_000_000;
export const DEFAULT_PARSE_TIMEOUT_MS = 2000;
export const DEFAULT_MAX_ISSUES = 50;

interface TSPoint {
  row: number;
  column: number;
}

export interface TSNode {
  type: string;
  isNamed: boolean;
  isError: boolean;
  isMissing: boolean;
  hasError: boolean;
  startPosition: TSPoint;
  endPosition: TSPoint;
  text: string;
  childCount: number;
  child(index: number): TSNode | null;
}

export interface TSTree {
  rootNode: TSNode;
  delete(): void;
}

export type TSLanguage = object;

interface TSParser {
  setLanguage(language: TSLanguage): void;
  reset(): void;
  parse(
    input: string,
    oldTree?: null,
    options?: { progressCallback?: (state: unknown) => boolean },
  ): TSTree | null;
}

interface TSParserClass {
  init(options: Record<string, unknown>): Promise<void>;
  new (): TSParser;
}

interface TSLanguageClass {
  load(bytes: Uint8Array): Promise<TSLanguage>;
}

export type GrammarName =
  | "bash"
  | "c-sharp"
  | "cpp"
  | "css"
  | "go"
  | "ini"
  | "java"
  | "javascript"
  | "php"
  | "powershell"
  | "python"
  | "regex"
  | "ruby"
  | "rust"
  | "tsx"
  | "typescript";

export const EXT_TO_GRAMMAR: Readonly<Record<string, GrammarName>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "c-sharp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".c": "cpp",
  ".h": "cpp",
  ".rb": "ruby",
  ".php": "php",
  ".sh": "bash",
  ".bash": "bash",
  ".css": "css",
  ".ini": "ini",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".psd1": "powershell",
};

export function grammarForPath(filePath: string): GrammarName | undefined {
  return EXT_TO_GRAMMAR[path.extname(filePath).toLowerCase()];
}

export function supportedExtensions(): string[] {
  return Object.keys(EXT_TO_GRAMMAR).sort();
}

export function probeTreeSitter(): boolean {
  try {
    createRequire(import.meta.url).resolve(PKG);
    return true;
  } catch {
    return false;
  }
}

type Importer = () => Promise<unknown>;

const defaultImporter: Importer = () => import("@vscode/tree-sitter-wasm");

let importer: Importer = defaultImporter;
let runtimePromise: Promise<Runtime | null> | null = null;
const languageCache = new Map<GrammarName, Promise<TSLanguage | null>>();

interface Runtime {
  parser: TSParser;
  loadLanguage: (bytes: Uint8Array) => Promise<TSLanguage>;
  wasmDir: string;
}

export function _resetTreeSitterForTests(fn?: Importer): void {
  importer = fn ?? defaultImporter;
  runtimePromise = null;
  languageCache.clear();
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function initRuntime(): Promise<Runtime | null> {
  try {
    const resolved = createRequire(import.meta.url).resolve(PKG);
    const wasmDir = path.dirname(resolved);
    const mod = (await importer()) as { default?: unknown };
    const ns = (mod.default ?? mod) as { Parser?: TSParserClass; Language?: TSLanguageClass };
    const Parser = ns.Parser;
    const Language = ns.Language;
    if (!Parser || !Language || typeof Language.load !== "function") {
      throw new Error(`unexpected module shape from ${PKG}`);
    }
    const wasmBinary = await fs.readFile(path.join(wasmDir, "tree-sitter.wasm"));
    await Parser.init({ wasmBinary, locateFile: (f: string) => path.join(wasmDir, f) });
    return {
      parser: new Parser(),
      loadLanguage: (bytes) => Language.load(bytes),
      wasmDir,
    };
  } catch (err) {
    warn(`clarvis-agent-tools: tree-sitter init failed: ${describeError(err)}\n`);
    return null;
  }
}

function getRuntime(): Promise<Runtime | null> {
  runtimePromise ??= initRuntime();
  return runtimePromise;
}

function getLanguage(grammar: GrammarName): Promise<TSLanguage | null> {
  let cached = languageCache.get(grammar);
  if (!cached) {
    cached = (async () => {
      const runtime = await getRuntime();
      if (!runtime) return null;
      try {
        const bytes = await fs.readFile(path.join(runtime.wasmDir, `tree-sitter-${grammar}.wasm`));
        return await runtime.loadLanguage(bytes);
      } catch (err) {
        warn(
          `clarvis-agent-tools: failed to load tree-sitter grammar ${grammar}: ` +
            `${describeError(err)}\n`,
        );
        return null;
      }
    })();
    languageCache.set(grammar, cached);
  }
  return cached;
}

export interface ParseLimits {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type ParseOutcome =
  | { status: "ok"; tree: TSTree }
  | { status: "unavailable" }
  | { status: "timeout" }
  | { status: "aborted" };

export async function parseText(
  content: string,
  grammar: GrammarName,
  limits: ParseLimits = {},
): Promise<ParseOutcome> {
  const { signal, timeoutMs = DEFAULT_PARSE_TIMEOUT_MS } = limits;
  if (signal?.aborted) return { status: "aborted" };
  if (timeoutMs <= 0) return { status: "timeout" };
  const deadline = Date.now() + timeoutMs;
  const runtime = await getRuntime();
  if (!runtime) return { status: "unavailable" };
  const language = await getLanguage(grammar);
  if (!language) return { status: "unavailable" };
  if (signal?.aborted) return { status: "aborted" };
  const progressCallback = (): boolean => signal?.aborted === true || Date.now() > deadline;
  try {
    runtime.parser.setLanguage(language);
    const tree = runtime.parser.parse(content, null, { progressCallback });
    if (!tree) {
      runtime.parser.reset();
      return signal?.aborted ? { status: "aborted" } : { status: "timeout" };
    }
    return { status: "ok", tree };
  } catch (err) {
    runtime.parser.reset();
    warn(`clarvis-agent-tools: tree-sitter parse failed: ${describeError(err)}\n`);
    return { status: "unavailable" };
  }
}

export interface SyntaxIssue {
  kind: "error" | "missing";
  line: number;
  column: number;
  near: string;
}

export interface SyntaxReport {
  ok: boolean;
  errors: SyntaxIssue[];
  truncated: boolean;
}

export type SyntaxOutcome = SyntaxReport | "unavailable" | "timeout" | "aborted";

function excerptAt(lines: string[], row: number): string {
  const line = (lines[row] ?? "").trim();
  return line.length > 80 ? `${line.slice(0, 80)}...` : line;
}

function collectIssues(
  node: TSNode,
  lines: string[],
  issues: SyntaxIssue[],
  maxIssues: number,
): boolean {
  if (!node.hasError && !node.isMissing) return false;
  if (node.isError || node.isMissing) {
    if (issues.length >= maxIssues) return true;
    issues.push({
      kind: node.isMissing ? "missing" : "error",
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
      near: node.isMissing ? node.type : excerptAt(lines, node.startPosition.row),
    });
    if (node.isError) return false;
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && collectIssues(child, lines, issues, maxIssues)) return true;
  }
  return false;
}

export function collectSyntaxIssues(
  root: TSNode,
  content: string,
  maxIssues = DEFAULT_MAX_ISSUES,
): { issues: SyntaxIssue[]; truncated: boolean } {
  if (!root.hasError && !root.isMissing) return { issues: [], truncated: false };
  const lines = content.split(/\r?\n/);
  const issues: SyntaxIssue[] = [];
  const truncated = collectIssues(root, lines, issues, maxIssues);
  return { issues, truncated };
}

export async function checkSyntaxText(
  content: string,
  grammar: GrammarName,
  opts: ParseLimits & { maxIssues?: number } = {},
): Promise<SyntaxOutcome> {
  const outcome = await parseText(content, grammar, opts);
  if (outcome.status !== "ok") return outcome.status;
  try {
    const { issues, truncated } = collectSyntaxIssues(
      outcome.tree.rootNode,
      content,
      opts.maxIssues ?? DEFAULT_MAX_ISSUES,
    );
    return { ok: issues.length === 0, errors: issues, truncated };
  } finally {
    outcome.tree.delete();
  }
}
