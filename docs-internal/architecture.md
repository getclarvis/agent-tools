# Architecture overview

> How `@clarvis/agent-tools` is wired: a transport-agnostic **library** that resolves a config once,
> advertises a fixed tool surface, and dispatches each call through a uniform pipeline — validate the
> arguments against the tool's JSON Schema, run the handler, bound the output, and serialize any
> error into a stable envelope. No transport, no agent loop, no network.

This page is a map of the moving parts. It traces a single `callTool` from entry to result, then
drills into the surface selection, the file-tool primitives (`lib/`), and the security boundary.
Every claim links to the source so you can read further. For the per-tool contracts themselves, see
[`SPEC.md`](../SPEC.md) and the published [tool reference](https://agent-tools.clarvis.dev/reference/tools).

## The big picture

There is no server and no I/O boundary the library owns. The caller builds a config, asks for the
tool surface to advertise to its model, and forwards each tool call in. Everything is synchronous
control flow around Node's `fs`/`child_process`.

```text
        your agent loop / transport (you own this)
                │  createAgentTools(options)  ─┐  resolveConfig
                │  .listTools()               ─┤  → ServerConfig (frozen-ish, per instance)
                │  .callTool(name, args)       │
                ▼                              ▼
┌───────────────────────────────────────────────────────────┐
│ DISPATCH  (src/core.ts)                                    │
│  getTool(name, surface)  ── unknown → not_found            │
│  validators.get(name)(args)  ── ajv, invalid → invalid_input
│  await tool.handler(args, config)                          │
│  tool.bounded ? text : bound(text, maxOutputBytes)         │
│  catch → serializeError(err)                               │
└───────────────┬───────────────────────────────────────────┘
                │ each ToolDef.handler
                ▼
┌───────────────────────────────────────────────────────────┐
│ TOOLS  (src/tools/*.ts)  read_file · list_dir · glob ·     │
│  grep · write_file · edit_file · multi_edit · apply_patch ·│
│  bash                                                      │
└───────────────┬───────────────────────────────────────────┘
                │ shared primitives
                ▼
   lib/: paths (confinement) · textfile+text+binary (decode) ·
         match-cascade (edit) · atomic (write+rollback+locks) ·
         rg+files+ignore (search) · output (bound/spill) · token

  cross-cutting: errors (ToolError · serializeError · ErrorCode)
```

`@clarvis/agent-tools` is **transport-agnostic**: it carries no transport and no agent loop. The
transport face, the CLI, the loop — all of that is the caller's. See the published
[how it works](https://agent-tools.clarvis.dev/explanation/how-it-works).

## Entry and config

The public surface is assembled in [`src/index.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/index.ts):
`createAgentTools(options)` calls `resolveConfig(options)` once and returns `{ config, listTools,
callTool }`, where `callTool` is a thin bind over `dispatch(name, args, config)`. The low-level
`dispatch` / `listTools` / `resolveConfig` / `buildConfig` and the raw registry are all re-exported
for callers that build their own transport.

Config resolution lives in [`src/config.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/config.ts).
`resolveConfig` validates the workspace root exists and is a directory, applies the numeric floors
(`MIN_OUTPUT_BYTES` / `MIN_FILE_BYTES` = 1024; `bashTimeoutMaxMs >= bashTimeoutMs`), probes for
ripgrep once (`spawnSync("rg", ["--version"])`, overridable via `options.probeRipgrep`), and returns
a `ServerConfig`. `buildConfig(argv, env)` is the argv/env front-end (for a CLI or long-running
service) that parses `--workspace` / `WORKSPACE_ROOT`, `READ_ONLY`, `ALLOW_OUTSIDE_WORKSPACE`, and
the byte/timeout vars, then delegates to `resolveConfig`. Bad input throws `StartupError`. See
[internals/config.md](./internals/config.md).

## The dispatch pipeline

The whole request path is [`dispatch`](https://github.com/getclarvis/agent-tools/blob/main/src/core.ts)
— under 30 lines, and the only place a tool result is shaped:

1. **Resolve the tool** against the active surface: `getTool(name, selectSurface(config.readOnly))`.
   A name not on the surface (unknown, or a mutating tool hidden by read-only mode) returns
   `not_found` — read-only hiding is indistinguishable from "does not exist" on purpose.
2. **Validate** with the tool's precompiled ajv validator (`ajv` is `new Ajv({ allErrors: true,
   useDefaults: true })`; one validator per tool is compiled at module load). On failure the joined
   `errorsText` becomes an `invalid_input` envelope.
3. **Run** `await tool.handler(args, config)`.
4. **Bound** the returned text: `tool.bounded ? text : bound(text, config.maxOutputBytes)`. Tools
   that manage their own output ceiling (only `bash` sets `bounded: true`) opt out of the outer
   `bound()`.
5. **Serialize errors**: any throw is caught and passed to `serializeError`, which emits a JSON
   envelope for a `ToolError` and a redacted `{ "error": "internal" }` (plus a stderr note) for
   anything else. `dispatch` never throws for tool-level problems — it returns `{ isError, text }`.

See [internals/dispatch.md](./internals/dispatch.md).

## The tool surface

The registry ([`src/tools/registry.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/tools/registry.ts))
is two ordered arrays of `ToolDef` and three helpers. `tools` is the full twenty; `readOnlyTools` is
the non-mutating seven (`read_file`, `read_image`, `list_dir`, `glob`, `grep`, `file_stat`, `tree`);
`selectSurface(readOnly)` picks
between them, `getTool` finds by name within a surface. `listTools(config)` maps the active surface
to the `{ name, description, inputSchema }[]` you advertise to a model. A `ToolDef`
([types.ts](https://github.com/getclarvis/agent-tools/blob/main/src/tools/types.ts)) is just a name,
description, JSON Schema, optional `bounded` flag, and an async `handler`. See
[internals/tools.md](./internals/tools.md).

## The file-tool primitives (`lib/`)

The tool handlers are thin; the real work is in `lib/`, shared across tools so behavior stays
consistent:

- **Path confinement** — [`lib/paths.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/paths.ts):
  `resolvePath` + `assertWithinWorkspace` canonicalize with `realpath` (including the existing
  prefix of a not-yet-created path) and reject escapes with `path_escape`. This is the security
  seam for the file tools. See [internals/paths-and-confinement.md](./internals/paths-and-confinement.md).
- **Text decode/encode** — [`lib/text.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/text.ts),
  [`textfile.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/textfile.ts),
  [`binary.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/binary.ts): BOM/encoding
  detection (UTF-8, UTF-16 LE/BE), EOL detection and preservation on re-encode, NUL-byte binary
  rejection. See [internals/text-and-encoding.md](./internals/text-and-encoding.md).
- **Edit matching** — [`lib/match-cascade.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/match-cascade.ts):
  the tiered `findCascadeMatch` behind `edit_file` / `multi_edit`. See
  [internals/matching.md](./internals/matching.md).
- **Atomic writes** — [`lib/atomic.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/atomic.ts):
  `writeAtomic` (temp + fsync + rename), `applyOpsAtomic` (multi-file with staged rollback), and the
  per-path `withFileLock` / `withFileLocks` serialization. See
  [internals/atomic-writes.md](./internals/atomic-writes.md).
- **Search** — [`lib/rg.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/rg.ts),
  [`files.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/files.ts),
  [`ignore.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/ignore.ts): the ripgrep
  backend and its in-process fallback (kept behaviorally consistent), `tinyglobby` listing, and
  gitignore semantics. See [internals/search.md](./internals/search.md).
- **Output bounding & spill** — [`lib/output.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/output.ts):
  `bound` (UTF-8-safe truncation with a marker), `boundOrSpill` (write overflow to `.clarvis/` and
  point at it), `allocateBudget`, and `sweepSpillDir`. See
  [internals/output-and-spill.md](./internals/output-and-spill.md).
- **Unique tokens** — [`lib/token.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/token.ts):
  `uniqueToken()` for temp/spill file names.

## The security boundary

Two layers, both documented for users under [Security](https://agent-tools.clarvis.dev/explanation/confinement)
and [SECURITY.md](../SECURITY.md):

- **File tools are workspace-confined by default.** Every path flows through `resolvePath(...,
  confineToWorkspace)`; with confinement on, a `../` escape, an absolute path outside the root, or a
  symlink that resolves outside is rejected with `path_escape`. Writes additionally refuse to follow
  a symlink at the target (`assertNotSymlink`).
- **`bash` is an intentional escape hatch.** It runs `sh -c <command>` (detached, in its own process
  group) with the full privileges of the host process; path confinement does **not** constrain the
  shell. The threat model is the host — run the whole thing inside an OS-level sandbox. The only
  guards `bash` itself applies are the per-stream capture ceiling (`output_limit`) and the timeout
  (kills the process group).

## See also

- [The core API & dispatch](https://agent-tools.clarvis.dev/reference/core-api) — user-facing contract
- [`SPEC.md`](../SPEC.md) — the canonical per-tool contract
- [source-map.md](./source-map.md) — behavior → `src/` index
- [internals/](./internals/) — one page per subsystem
