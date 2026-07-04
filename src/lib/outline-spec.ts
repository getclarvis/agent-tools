import type { GrammarName, TSNode } from "./treesitter.js";

export interface OutlineSpec {
  capture: ReadonlySet<string>;
  passThrough: ReadonlySet<string>;
  functionVariables?: boolean;
}

export interface OutlineEntry {
  depth: number;
  startLine: number;
  endLine: number;
  header: string;
}

export const OUTLINE_MAX_ENTRIES = 2000;
const HEADER_MAX_CHARS = 150;

const ecmascript: OutlineSpec = {
  capture: new Set([
    "function_declaration",
    "generator_function_declaration",
    "class_declaration",
    "abstract_class_declaration",
    "interface_declaration",
    "enum_declaration",
    "type_alias_declaration",
    "internal_module",
    "module",
    "function_signature",
    "method_definition",
    "method_signature",
    "abstract_method_signature",
    "public_field_definition",
  ]),
  passThrough: new Set([
    "program",
    "export_statement",
    "expression_statement",
    "ambient_declaration",
    "statement_block",
    "class_body",
    "interface_body",
  ]),
  functionVariables: true,
};

export const OUTLINE_SPECS: Partial<Record<GrammarName, OutlineSpec>> = {
  typescript: ecmascript,
  tsx: ecmascript,
  javascript: ecmascript,
  python: {
    capture: new Set(["function_definition", "class_definition"]),
    passThrough: new Set(["module", "decorated_definition", "block"]),
  },
  go: {
    capture: new Set(["function_declaration", "method_declaration", "type_spec"]),
    passThrough: new Set(["source_file", "type_declaration"]),
  },
  rust: {
    capture: new Set([
      "function_item",
      "struct_item",
      "enum_item",
      "trait_item",
      "impl_item",
      "mod_item",
      "macro_definition",
    ]),
    passThrough: new Set(["source_file", "declaration_list"]),
  },
  java: {
    capture: new Set([
      "class_declaration",
      "interface_declaration",
      "enum_declaration",
      "record_declaration",
      "method_declaration",
      "constructor_declaration",
    ]),
    passThrough: new Set(["program", "class_body", "interface_body", "enum_body"]),
  },
  "c-sharp": {
    capture: new Set([
      "namespace_declaration",
      "file_scoped_namespace_declaration",
      "class_declaration",
      "interface_declaration",
      "struct_declaration",
      "enum_declaration",
      "record_declaration",
      "method_declaration",
      "constructor_declaration",
      "property_declaration",
    ]),
    passThrough: new Set(["compilation_unit", "declaration_list"]),
  },
};

const FUNCTION_VALUE_TYPES = new Set([
  "arrow_function",
  "function_expression",
  "generator_function",
]);

const VARIABLE_DECLARATION_TYPES = new Set(["lexical_declaration", "variable_declaration"]);

function isFunctionVariable(node: TSNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const declarator = node.child(i);
    if (!declarator || declarator.type !== "variable_declarator") continue;
    for (let j = 0; j < declarator.childCount; j++) {
      const value = declarator.child(j);
      if (value && FUNCTION_VALUE_TYPES.has(value.type)) return true;
    }
  }
  return false;
}

function headerFor(node: TSNode): string {
  let line = (node.text.split("\n", 1)[0] ?? "").trim();
  line = line.replace(/[{:]\s*$/, "").trimEnd();
  return line.length > HEADER_MAX_CHARS ? `${line.slice(0, HEADER_MAX_CHARS)}...` : line;
}

function entryFor(node: TSNode, depth: number): OutlineEntry {
  return {
    depth,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    header: headerFor(node),
  };
}

function walk(node: TSNode, depth: number, spec: OutlineSpec, entries: OutlineEntry[]): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child || !child.isNamed) continue;
    if (spec.capture.has(child.type)) {
      entries.push(entryFor(child, depth));
      walk(child, depth + 1, spec, entries);
    } else if (spec.passThrough.has(child.type)) {
      walk(child, depth, spec, entries);
    } else if (
      spec.functionVariables === true &&
      depth === 0 &&
      VARIABLE_DECLARATION_TYPES.has(child.type) &&
      isFunctionVariable(child)
    ) {
      entries.push(entryFor(child, depth));
    }
  }
}

export function extractOutline(root: TSNode, spec: OutlineSpec): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  walk(root, 0, spec, entries);
  return entries;
}
