# Internals: error codes & envelope

Source-level reference for the error contract. The user-facing catalog lives at
[error codes](https://agent-tools.clarvis.dev/reference/error-codes); this page covers the `ToolError`
shape, the serialization boundary, and the fs-error mapping the published page omits.

## Source file

[`src/errors.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/errors.ts) — exports the
`ErrorCode` union, the `ToolError` class, `serializeError`, and `fsError`.

## Exports

| Symbol | Kind | Notes |
|---|---|---|
| `ErrorCode` | type | The closed union of error codes (below). |
| `ToolError` | class | `Error` subclass carrying `code: ErrorCode` and `fields: Record<string, unknown>`. |
| `serializeError(err)` | function | `unknown` → the JSON envelope string. The single serialization boundary. |
| `fsError(err, path)` | function | Maps a Node `ErrnoException` to a coded `ToolError`. |

## The code union

```ts
type ErrorCode =
  | "invalid_input" | "not_found" | "not_a_file" | "is_binary"
  | "no_match" | "ambiguous_match" | "patch_failed" | "io_error"
  | "timeout" | "output_limit" | "too_large" | "path_escape" | "internal";
```

Where each is raised (representative, not exhaustive):

| Code | Raised by |
|---|---|
| `invalid_input` | ajv validation (`core.ts`); bad regex / ripgrep error (`rg.ts`); rename-dest-exists & write-through-symlink (`atomic.ts`). |
| `not_found` | unknown/hidden tool (`core.ts`); missing file `ENOENT` (`fsError`); rename source missing. |
| `not_a_file` | `EISDIR`/`ENOTDIR` and directory-where-file-expected (`fsError`, `textfile.ts`, `files.ts`). |
| `is_binary` | NUL-bearing non-UTF-16 file in `readTextFile`. |
| `no_match` / `ambiguous_match` | the edit match cascade (0 spans / >1 span). |
| `patch_failed` | `apply_patch` diff parse/apply. |
| `too_large` | file over `maxFileBytes` in `readTextFile`. |
| `output_limit` | `bash` stream over the capture ceiling. |
| `timeout` | `bash` command over `timeoutMs`. |
| `path_escape` | `assertWithinWorkspace` (confinement on). |
| `io_error` | fallback fs error; unrestorable rollback; spawn/finalize failures. |
| `internal` | anything that isn't a `ToolError` (see below). |

## The envelope: `serializeError(err)`

The one place a result error is shaped:

```ts
// ToolError → coded envelope, spreading its fields
{ "error": "<code>", "message": "<message>", ...fields }
// anything else → logged to stderr, opaque envelope returned
{ "error": "internal", "message": "internal error" }
```

- A `ToolError`'s `fields` (e.g. `{ path }`, `{ size, limit }`, `{ pattern }`, `{ stdout, stderr,
  timeout_ms }`) are spread into the envelope alongside `error`/`message`, so callers get structured
  detail without a separate shape.
- A **non-`ToolError`** throw is treated as a bug: its `stack ?? message` is written to `process.stderr`
  (`clarvis-agent-tools: internal error: ...`) and the caller receives only the opaque `internal`
  envelope — no internal detail or secret leaks into the tool result. This is deliberate: expected
  failures must be `ToolError`s; anything else is a programming error surfaced safely.

`dispatch` calls `serializeError` in its `catch`, so a handler simply `throw`s and never formats an
envelope itself.

## fs-error mapping: `fsError(err, path)`

Normalizes Node errno codes to `ToolError`s so tools don't hand-roll the mapping:

| errno | → code / message |
|---|---|
| `ENOENT` | `not_found` — "No such file: `<path>`" |
| `EISDIR` | `not_a_file` — "Path is a directory: `<path>`" |
| `ENOTDIR` | `not_a_file` — "Not a directory: `<path>`" |
| anything else | `io_error` — "`<code|EIO>`: `<message>`" |

All variants carry `{ path }` in `fields`.

## Maintainer notes

- **Expected failures are `ToolError`s.** If a handler can fail for a foreseeable reason, throw a
  `ToolError` with the right code and useful `fields` — never a bare `Error`, or the caller gets the
  opaque `internal` envelope.
- **Route fs failures through `fsError`** so `ENOENT`/`EISDIR`/`ENOTDIR` map consistently everywhere.
- **Adding a code:** extend the `ErrorCode` union, raise it where appropriate, and mirror it in
  `docs/reference/error-codes.md` and `SPEC.md`. Keep the union closed — it's part of the public
  contract that consumers switch on.
- **`fields` must not carry secrets.** They're spread verbatim into the result; `bash` deliberately
  includes bounded/spilled `stdout`/`stderr`, so those are already output-capped, not raw.
