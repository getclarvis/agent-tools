# Core API

> The building blocks under `createAgentTools`: dispatch and listing against a config, the raw tool
> registry, the spill sweeper, and the error contract. Use these to build a custom transport — see
> [The core API guide](/guide/the-core-api) for the how-to.

## `dispatch`

```ts
function dispatch(
  name: string,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<DispatchResult>;
```

Looks up `name` in the surface for `config` (respecting `readOnly`), validates `args` against the
tool's JSON Schema with ajv, runs the handler, bounds the output to `maxOutputBytes`, and serializes
any thrown error. It **never throws** — an unknown tool, invalid arguments, or a tool-level failure
all come back as an `isError` result.

<!-- @include: @/_partials/dispatch-result.md -->

## `listTools`

```ts
function listTools(config: ServerConfig): ToolInfo[];
```

The advertised surface for `config` — `{ name, description, inputSchema }` per tool, honoring
`readOnly`. See [`ToolInfo`](/reference/create-agent-tools#toolinfo).

## The registry

```ts
const tools: ToolDef[]; // all twenty-five
const readOnlyTools: ToolDef[]; // read_file, read_files, read_image, list_dir, glob, grep, diff, file_stat, tree, outline, check_syntax

function selectSurface(readOnly: boolean, treeSitterAvailable?: boolean): ToolDef[];
function getTool(name: string, surface?: ToolDef[]): ToolDef | undefined;
```

- **`tools`** — every `ToolDef`, in registration order.
- **`readOnlyTools`** — the non-mutating subset.
- **`selectSurface(readOnly)`** — `readOnlyTools` when `true`, else `tools`. This is what
  `dispatch`/`listTools` use to honor `config.readOnly`.
- **`getTool(name, surface = tools)`** — find one tool by name within a surface, or `undefined`.

### `ToolDef`

```ts
interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema, ajv-validated on dispatch
  bounded?: boolean; // when true, the handler bounds its own output (dispatch skips re-bounding)
  handler: (
    args: Record<string, unknown>,
    config: ServerConfig,
    signal?: AbortSignal,
  ) => Promise<string | ContentPart[]>; // a plain string is sugar for a single text part
}
```

`listTools` projects a `ToolDef` down to `ToolInfo` (drops `handler`/`bounded`). If you call a
`handler` yourself, you bypass validation and output bounding — prefer `dispatch` unless you have a
reason not to.

## `sweepSpillDir`

```ts
function sweepSpillDir(workspaceRoot: string): Promise<void>;
```

Removes stale `bash` spill files from the `.clarvis/` directory under `workspaceRoot`. Safe to call
periodically in a long-lived process. See [Limits & spill](/guide/limits-and-spill).

## `sweepMonitors`

```ts
function sweepMonitors(workspaceRoot: string): Promise<void>;
```

The companion to `sweepSpillDir` for background monitors. It removes the `.clarvis/monitor-<id>.*`
sidecars of monitors whose process has already **exited**, and leaves live ones untouched. A
monitor's process outlives the tool call (and host exit), so a forgotten monitor leaks — call
`sweepMonitors` at session start, and use `monitor_list` / `monitor_stop` to find and stop any that
are still running. See [The tools](/reference/tools#monitor_start) and
[Limits & spill](/guide/limits-and-spill).

## Errors

```ts
type ErrorCode =
  | "invalid_input" | "not_found" | "not_a_file" | "is_binary" | "not_an_image"
  | "no_match" | "ambiguous_match" | "patch_failed" | "io_error"
  | "timeout" | "aborted" | "output_limit" | "too_large" | "path_escape"
  | "monitor_not_found" | "too_many_monitors" | "internal";

class ToolError extends Error {
  readonly code: ErrorCode;
  readonly fields: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, fields?: Record<string, unknown>);
}

function serializeError(err: unknown): string;
function fsError(err: NodeJS.ErrnoException, path: string): ToolError;
```

- **`ToolError`** — the structured error a tool handler throws. `code` is the stable
  [error code](/reference/error-codes); `fields` are merged into the serialized envelope.
- **`serializeError(err)`** — turns a `ToolError` into the JSON envelope
  `{ error, message, ...fields }`. Any non-`ToolError` is logged to stderr and returned as
  `{ "error": "internal", "message": "internal error" }`, so raw internals never leak to the caller.
- **`fsError(err, path)`** — maps a Node `fs` errno (`ENOENT` → `not_found`, `EISDIR`/`ENOTDIR` →
  `not_a_file`, else `io_error`) to a `ToolError`. Useful when writing your own tool handlers.

`StartupError` (thrown by `resolveConfig` / `buildConfig` on bad config) is a separate class,
exported from the package root.

## See also

- [The core API guide](/guide/the-core-api) — building a transport with these primitives
- [createAgentTools](/reference/create-agent-tools) — the factory that wraps `dispatch`/`listTools`
- [Error codes](/reference/error-codes) — the envelope and every `error` value
- [Configuration](/reference/configuration) — `resolveConfig` / `buildConfig` / `ServerConfig`
