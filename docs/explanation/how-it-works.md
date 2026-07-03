# How it works

> A conceptual map of what happens between your `callTool` and the result: the config you resolve
> once, the surface it selects, and the five-step pipeline every tool call runs through. This is the
> library's whole mechanism — there is no agent loop and no transport inside it.

## The shape of the package

`@clarvis/agent-tools` is deliberately small. There are three layers and nothing else:

```text
      your code (agent loop / transport)
                │  callTool(name, args)  ·  listTools()
                ▼
┌───────────────────────────────────────────────────────────┐
│ DISPATCH                                                    │
│   select surface → validate (ajv) → run handler →           │
│   bound output → serialize errors      →  { isError, text } │
└───────────────┬─────────────────────────────────────────────┘
                │  handler(args, config)
                ▼
      the tool registry (14 ToolDefs)
                │
                ▼
      the workspace  (fs · child_process · ripgrep?)

  resolved once, read everywhere:  ServerConfig (root · limits · readOnly · confine)
```

You own the top layer; the package is the middle and bottom.

## Config is resolved once, then frozen

`resolveConfig` (called by `createAgentTools`) runs at construction: it validates the options, checks
the workspace directory exists, probes for ripgrep, and returns an immutable `ServerConfig`. Every
subsequent `callTool` / `dispatch` reads that same config — there is no per-call setup and no hidden
global state. A bad config fails fast, synchronously, with a `StartupError`. See
[Configuration](/reference/configuration).

## The surface

`selectSurface(config.readOnly)` decides which tools exist: all fourteen, or just the five read tools in
[read-only mode](/guide/read-only-mode). Both `listTools` (what you advertise) and `dispatch` (what
you can call) go through it, so the advertised surface and the callable surface are always the same
set — there is no separate allow-list.

## The dispatch pipeline

Each `callTool(name, args)` runs the same five steps:

1. **Select & look up.** Find `name` in the active surface. Unknown (or hidden by `readOnly`) →
   an `isError` result with code `not_found`. No exception.
2. **Validate.** Check `args` against the tool's JSON Schema with ajv (`allErrors`, `useDefaults`, so
   defaults are filled in). A failure → `invalid_input` with the ajv detail.
3. **Run the handler.** Call `handler(args, config)`. This is where the filesystem or a child process
   is touched — and where [confinement](/explanation/confinement) rejects an escaping path.
4. **Bound the output.** Truncate the result to `maxOutputBytes` on a UTF-8 boundary (unless the tool
   is marked `bounded`, i.e. it already capped its own output — `bash`, which spills overflow to
   disk). See [Limits & spill](/guide/limits-and-spill).
5. **Serialize.** Return `{ isError: false, text }` on success; on a thrown `ToolError`, return
   `{ isError: true, text }` with the JSON [error envelope](/reference/error-codes). A non-`ToolError`
   is logged to stderr and returned as a generic `internal` error.

The result is always `{ isError, text }` — the pipeline converts every outcome, success or failure,
into that one shape.

## Stateless calls, atomic writes

`dispatch` holds no state between calls, so independent tool calls run concurrently. Mutations are
made durable with a temp file + `rename`, and multi-file operations (`apply_patch`) stage all changes
and commit or roll back together. Writes to the **same path** are serialized by an in-process lock.
This is a single-process contract: separate processes or external editors are not coordinated.

## What it deliberately isn't

- **No agent loop.** The package doesn't call a model or decide what to do next — that's your loop.
- **No transport.** No HTTP, socket, or RPC server is bundled. The core primitives let you build
  whatever transport you need.
- **No sandbox.** Confinement guards the *file* tools; `bash` runs arbitrary commands. Isolation is
  the host's job — see [Deploy securely](/operations/deploy-securely).

## See also

- [The core API](/guide/the-core-api) — driving `dispatch`/`listTools` yourself
- [Workspace confinement](/explanation/confinement) — the path guard in step 3
- [Text & encoding](/explanation/text-and-encoding) — how the file tools treat bytes
- [Error codes](/reference/error-codes) — the envelope step 5 produces
