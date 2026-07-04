import type { BashFacts, Segment } from "./types.js";

const UNDECIDABLE_PATTERNS: RegExp[] = [
  /\$\(/,
  /`/,
  /\$\{?[A-Za-z_]/,
  /\beval\b/,
  /\bexec\b/,
  /\bsource\b/,
  /\benv\b/,
  /\bxargs\b/,
  /\bbase64\b/,
  /\bsh\b\s+-c/,
  /\bbash\b\s+-c/,
  /<\(/,
  />\(/,
];

const PATH_METACHARS = /[$,*?[\](){}|<>!;=&`]/;
const GLOB_METACHARS = /[*?[\]{}]/;
const DOTDOT = /(^|\/)\.\.(\/|$)/;
const TILDE_USER = /^~[^/]/;

const SAFE_WRAPPERS = new Set(["timeout", "time", "nice", "nohup", "stdbuf"]);
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const TIMEOUT_DURATION = /^[0-9]+(\.[0-9]+)?[smhd]?$/;

function looksLikePath(token: string): boolean {
  if (token === "" || token.startsWith("-")) return false;
  if (PATH_METACHARS.test(token)) return false;
  if (token.includes("/")) return true;
  if (/^[~.]/.test(token)) return true;
  if (/^[\w.-]+\.\w+$/.test(token)) return true;
  return false;
}

function globLiteralPrefix(token: string): string {
  const idx = token.search(GLOB_METACHARS);
  const head = idx === -1 ? token : token.slice(0, idx);
  const slash = head.lastIndexOf("/");
  if (slash === -1) return ".";
  if (slash === 0) return "/";
  return head.slice(0, slash);
}

function scrubExpansions(command: string): { scrubbed: string; unbalanced: boolean } {
  let out = "";
  let quote: '"' | "'" | null = null;
  for (const ch of command) {
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      out += ch;
      continue;
    }
    if (ch === "'") {
      quote = "'";
      continue;
    }
    if (ch === '"') {
      quote = '"';
      out += ch;
      continue;
    }
    out += ch;
  }
  return { scrubbed: out, unbalanced: quote !== null };
}

interface Token {
  text: string;
  glob: boolean;
}

function tokenize(command: string): Token[] {
  const tokens: Token[] = [];
  let cur = "";
  let curGlob = false;
  let quote: '"' | "'" | null = null;
  let backtick = false;
  let depth = 0;
  let subst = 0;
  const push = (): void => {
    if (cur) tokens.push({ text: cur, glob: curGlob });
    cur = "";
    curGlob = false;
  };
  for (const ch of command) {
    if (subst > 0) {
      if (ch === "(") subst++;
      else if (ch === ")") subst--;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (backtick) {
      if (ch === "`") backtick = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "`") {
      backtick = true;
      continue;
    }
    if (ch === "(") {
      if (cur.endsWith("$") || cur.endsWith("<") || cur.endsWith(">")) {
        cur = cur.slice(0, -1);
        push();
        subst++;
        continue;
      }
      push();
      depth++;
      continue;
    }
    if (ch === ")") {
      push();
      if (depth > 0) depth--;
      continue;
    }
    if (/\s/.test(ch)) {
      push();
      continue;
    }
    if (GLOB_METACHARS.test(ch)) curGlob = true;
    cur += ch;
  }
  push();
  return tokens;
}

function isRedirectAmpersand(command: string, i: number): boolean {
  return command.startsWith("&>", i) || (i > 0 && command[i - 1] === ">");
}

function splitByOperators(command: string): { segments: string[]; balanced: boolean } {
  const out: string[] = [];
  let cur = "";
  let single = false;
  let double = false;
  let backtick = false;
  let depth = 0;
  const flush = (): void => {
    const s = cur.trim();
    if (s) out.push(s);
    cur = "";
  };
  let i = 0;
  while (i < command.length) {
    const c = command[i];
    if (single) {
      cur += c;
      if (c === "'") single = false;
      i++;
      continue;
    }
    if (double) {
      cur += c;
      if (c === '"') double = false;
      i++;
      continue;
    }
    if (backtick) {
      cur += c;
      if (c === "`") backtick = false;
      i++;
      continue;
    }
    if (c === "'") {
      single = true;
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      double = true;
      cur += c;
      i++;
      continue;
    }
    if (c === "`") {
      backtick = true;
      cur += c;
      i++;
      continue;
    }
    if (c === "(") {
      depth++;
      cur += c;
      i++;
      continue;
    }
    if (c === ")") {
      if (depth > 0) depth--;
      cur += c;
      i++;
      continue;
    }
    if (depth === 0) {
      if (command.startsWith("&&", i) || command.startsWith("||", i)) {
        flush();
        i += 2;
        continue;
      }
      if (c === "&" && !isRedirectAmpersand(command, i)) {
        flush();
        i++;
        continue;
      }
      if (c === ";" || c === "|" || c === "\n") {
        flush();
        i++;
        continue;
      }
    }
    cur += c;
    i++;
  }
  flush();
  const balanced = !single && !double && !backtick && depth === 0;
  return { segments: out, balanced };
}

function stripEnvAndWrappers(tokens: string[]): string[] {
  let i = 0;
  const skipEnv = (): void => {
    let t = tokens[i];
    while (t !== undefined && ENV_ASSIGN.test(t)) {
      i++;
      t = tokens[i];
    }
  };
  skipEnv();
  let head = tokens[i];
  while (head !== undefined && SAFE_WRAPPERS.has(head)) {
    const wrapper = head;
    i++;
    let opt = tokens[i];
    while (opt !== undefined && opt.startsWith("-")) {
      i++;
      opt = tokens[i];
    }
    const duration = tokens[i];
    if (wrapper === "timeout" && duration !== undefined && TIMEOUT_DURATION.test(duration)) i++;
    skipEnv();
    head = tokens[i];
  }
  return tokens.slice(i);
}

function buildSegment(source: string): Segment {
  const { scrubbed, unbalanced } = scrubExpansions(source);
  const decidable = !unbalanced && !UNDECIDABLE_PATTERNS.some((re) => re.test(scrubbed));
  const argv = stripEnvAndWrappers(tokenize(source).map((t) => t.text));
  return { command: source, argv, normalized: argv.join(" "), decidable };
}

export function analyzeBash(command: string): BashFacts {
  const { segments: sources, balanced } = splitByOperators(command);
  const segments = sources.map(buildSegment);

  const paths: string[] = [];
  const seen = new Set<string>();
  let tokenUndecidable = false;
  for (const seg of segments) {
    for (const token of tokenize(seg.command)) {
      if (TILDE_USER.test(token.text)) {
        tokenUndecidable = true;
        continue;
      }
      if (token.glob) {
        if (DOTDOT.test(token.text)) tokenUndecidable = true;
        const prefix = globLiteralPrefix(token.text);
        if (!seen.has(prefix)) {
          seen.add(prefix);
          paths.push(prefix);
        }
        continue;
      }
      if (looksLikePath(token.text) && !seen.has(token.text)) {
        seen.add(token.text);
        paths.push(token.text);
      }
    }
  }

  const undecidable = !balanced || tokenUndecidable || segments.some((s) => !s.decidable);
  return { paths, undecidable, segments };
}
