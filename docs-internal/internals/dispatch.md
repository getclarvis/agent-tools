# Internals: dispatch pipeline

Source-level reference for the request path and the tool registry. The user-facing description of the
pipeline lives at [how it works](https://agent-tools.clarvis.dev/explanation/how-it-works) and
[the core API](https://agent-tools.clarvis.dev/reference/core-api); this page covers the exact
control flow, the ajv setup, and the surface-selection rules the published pages omit.

## Source files

| Path | Responsibility |
|---|---|
| [`src/core.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/core.ts) | `dispatch`, `listTools`, the ajv instance, and the precompiled per-tool validators. |
| [`src/tools/registry.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/tools/registry.ts) | The `tools` / `readOnlyTools` arrays and `selectSurface` / `getTool`. |
| [`src/tools/types.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/tools/types.ts) | The `ToolDef` interface. |
| [`src/index.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/index.ts) | `createAgentTools` — binds `dispatch`/`listTools` to one resolved config. |

## Exports

| Symbol | Kind | Notes |
|---|---|---|
| `dispatch(name, args, config)` | function | The whole request path. Returns `Promise<DispatchResult>` (`{ isError, text }`); never throws for tool-level problems. |
| `listTools(config)` | function | Maps `selectSurface(config.readOnly)` to `{ name, description, inputSchema }[]`. |
| `DispatchResult` / `ToolInfo` | types | `{ isError: boolean; text: string }` and the advertised tool shape. |

## ajv setup

At module load, `core.ts` constructs a single `Ajv({ allErrors: true, useDefaults: true })` and
compiles one validator per tool into a `Map<string, ValidateFunction>`:

```ts
const ajv = new Ajv({ allErrors: true, useDefaults: true });
const validators = new Map<string, ValidateFunction>();
for (const tool of tools) validators.set(tool.name, ajv.compile(tool.inputSchema));
```

- **`useDefaults`** means a schema-level `default` is filled into `args` in place during validation —
  tools rely on this for optional numeric/boolean params.
- **`allErrors`** collects every violation so `ajv.errorsText(errors, { separator: "; " })` can join
  them into one `invalid_input` message.
- Ajv is loaded via `createRequire(import.meta.url)("ajv")` (CJS interop) — the default export is the
  `Ajv` class.
- Validators are compiled over the **full** `tools` array, not the active surface, so a read-only
  config still has a compiled validator for every tool; surface selection happens separately.

## `dispatch` control flow

The five steps, in order (see [architecture.md](../architecture.md) for the diagram):

1. **Resolve** — `getTool(name, selectSurface(config.readOnly))`. Miss → return an `isError` envelope
   with code `not_found` (`Unknown tool: <name>`). A mutating tool under `readOnly: true` is simply
   absent from the surface, so it also returns `not_found` — read-only hiding is deliberately
   indistinguishable from "does not exist".
2. **Validate** — `validators.get(name)!(args)`. Failure → `invalid_input` with the joined
   `errorsText` (or `"invalid arguments"` if empty).
3. **Handle** — `await tool.handler(args, config)` returns a `string` (already JSON where the tool
   emits structured output, e.g. `bash`).
4. **Bound** — `tool.bounded ? text : bound(text, config.maxOutputBytes)`. Only `bash` sets
   `bounded: true` (it does its own `boundOrSpill` per stream); every other tool's output goes
   through the outer `bound()`. See [internals/output-and-spill.md](./output-and-spill.md).
5. **Catch** — any throw → `serializeError(err)`. A `ToolError` becomes
   `{ error: code, message, ...fields }`; anything else is logged to stderr and returned as the
   opaque `{ error: "internal", message: "internal error" }`. See [internals/errors.md](./errors.md).

## `listTools`

`listTools(config)` is pure and independent of `dispatch`: it maps the active surface to the
advertised triples. `inputSchema` is passed by reference (the same object ajv compiled) — callers
must treat it as read-only.

## Statelessness

`dispatch` holds no per-call state; the module-level `ajv`/`validators` are build-once and immutable.
Concurrency safety for file mutations is enforced deeper, by the per-path locks in
[`lib/atomic.ts`](./atomic-writes.md), not here. This is what `tests/integration/statelessness.test.ts`
guards.

## Maintainer notes

- **Adding a tool:** append its `ToolDef` to `tools` in `registry.ts` (and to `readOnlyTools` if
  non-mutating); the validator is picked up automatically by the module-load loop. Add
  `tests/contract/<tool>.test.ts`, a `SPEC.md` entry, and a `docs/reference/tools.md` row.
- **A tool that bounds its own output** must set `bounded: true` and call `boundOrSpill`/`bound`
  itself, or its output will be double-truncated.
- **Never let a handler throw a non-`ToolError` for an expected failure** — the caller would get the
  opaque `internal` envelope instead of a coded one. Map fs errors through `fsError`.
