# Internals: the tool registry & handlers

Source-level reference for the nine tool handlers and how they're registered. The user-facing tool
contracts live in [`SPEC.md`](../../SPEC.md) and the published
[tools reference](https://agent-tools.clarvis.dev/reference/tools); this page maps each tool to its
`src/` module and the `lib/` primitives it leans on.

## Source files

| Path | Responsibility |
|---|---|
| [`src/tools/registry.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/tools/registry.ts) | `tools`, `readOnlyTools`, `selectSurface`, `getTool`. |
| [`src/tools/types.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/tools/types.ts) | `ToolDef` — `{ name, description, inputSchema, bounded?, handler }`. |
| `src/tools/*.ts` | One module per tool, each exporting a `ToolDef`. |

## The `ToolDef` shape

```ts
interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;          // JSON Schema, ajv-compiled at load
  bounded?: boolean;                              // true → tool owns its output ceiling
  handler: (args, config: ServerConfig) => Promise<string>;
}
```

The handler always returns a `string`. Where a tool has structured output (`bash`), it returns
`JSON.stringify(...)`. Errors are thrown as `ToolError` and serialized by `dispatch`, never returned.

## The registry

```ts
export const tools: ToolDef[] = [readFile, writeFile, editFile, multiEdit, applyPatchTool,
                                 listDir, globTool, grep, bash];
export const readOnlyTools: ToolDef[] = [readFile, listDir, globTool, grep];
```

`selectSurface(readOnly)` returns one or the other; `getTool(name, surface)` is a `find` by name.
Order in `tools` is the order `listTools` advertises them.

## The nine tools

| Tool | Module | Mutating | Key `lib/` primitives |
|---|---|---|---|
| `read_file` | `read-file.ts` | no | `resolvePath` · `readTextFile` (decode + `too_large` + binary reject) · line numbering/paging/tail |
| `list_dir` | `list-dir.ts` | no | `resolvePath` · `statDirectory` · `readdir` |
| `glob` | `glob.ts` | no | `resolvePath` · `listFiles` (`tinyglobby` + gitignore) · mtime sort |
| `grep` | `grep.ts` | no | `grepSearch` (ripgrep or in-process) — see [internals/search.md](./search.md) |
| `write_file` | `write-file.ts` | yes | `resolvePath` · `writeAtomic` (+ `withFileLock`) |
| `edit_file` | `edit-file.ts` | yes | `readTextFile` · `findCascadeMatch` · `reencode` · `writeAtomic` |
| `multi_edit` | `multi-edit.ts` | yes | same as `edit_file`, applied sequentially under one lock, atomic |
| `apply_patch` | `apply-patch.ts` | yes | `diff` parse → `FileOp[]` · `applyOpsAtomic` (multi-file rollback) |
| `bash` | `bash.ts` | yes | `sh -c`, process-group kill, `boundOrSpill` + `allocateBudget` — `bounded: true` |

- **Read-only surface** is exactly `read_file`, `list_dir`, `glob`, `grep`. Everything else is hidden
  under `readOnly: true` and returns `not_found`.
- **`bash` is the only `bounded: true` tool** — it splits `maxOutputBytes` across stdout/stderr with
  `allocateBudget` and spills overflow, so it opts out of `dispatch`'s outer `bound()`. See
  [internals/output-and-spill.md](./output-and-spill.md).
- **Path confinement** is applied by each file tool through `resolvePath(input, workspaceRoot,
  config.confineToWorkspace)`; `bash` confines only its `cwd`, never the command. See
  [internals/paths-and-confinement.md](./paths-and-confinement.md).
- **Writes go through `lib/atomic.ts`** so a crash mid-write never truncates the target, and
  concurrent writes to the same path serialize. See [internals/atomic-writes.md](./atomic-writes.md).

## Maintainer notes

- **Handlers stay thin.** Push shared behavior into `lib/` so both grep backends, all four writers, and
  the two edit tools stay consistent — a fix in a `lib/` primitive should fix every tool that uses it.
- **Schema is the input contract.** `additionalProperties: false` and explicit `required` keep the
  ajv validator strict; rely on `useDefaults` for optional params rather than reading `?? default` in
  the handler where possible.
- **Adding a tool:** see [internals/dispatch.md](./dispatch.md#maintainer-notes) for the registry +
  validator + test + docs checklist.
