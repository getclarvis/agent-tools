# Error codes

> Every tool failure is one JSON envelope with a stable `error` code. This page lists the codes and
> what triggers each. Match on `error`, never on `message`.

## The envelope

<!-- @include: @/_partials/error-envelope.md -->

In [`DispatchResult`](/reference/create-agent-tools#dispatchresult) terms: a failure sets
`isError: true` and puts this JSON in the single text part of `content` (read it with
`contentText(content)`). Success never uses the envelope — its `content` is the tool's output (or,
for `bash`, a `{ exit_code, … }` JSON object, which is **not** an error even on a non-zero exit).

## Codes

| Code              | Meaning                                                      | Raised by (examples)                                   |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `invalid_input`   | Arguments failed schema or semantic validation.              | Any tool (ajv); `edit_file` identical strings.         |
| `not_found`       | Path does not exist — or the tool name is unknown/hidden.    | All path tools; unknown/read-only-hidden tool.         |
| `not_a_file`      | Path was a directory where a file was expected (or vice).    | `read_file`, `list_dir`, `write_file`, `apply_patch`, `bash` (bad `cwd`). |
| `is_binary`       | File appears binary; text tools refuse it.                   | `read_file`, `edit_file`, `multi_edit`, `apply_patch`. |
| `not_an_image`    | File is not a supported image format (PNG/JPEG/GIF/WebP).    | `read_image`.                                          |
| `no_match`        | `old_string` was not found.                                  | `edit_file`, `multi_edit`.                             |
| `ambiguous_match` | `old_string` matched more than once without `replace_all`.   | `edit_file`, `multi_edit`.                             |
| `patch_failed`    | A patch hunk did not apply cleanly (names the file).         | `apply_patch`.                                         |
| `timeout`         | The command exceeded its timeout (partial output returned).  | `bash`.                                                |
| `output_limit`    | Output exceeded the hard capture ceiling; the command was killed. | `bash`.                                            |
| `aborted`         | The run was cancelled via the dispatch `AbortSignal`; the process group was SIGKILLed. | `bash`.                       |
| `too_large`       | Input file exceeded `maxFileBytes`.                          | `read_file`, `edit_file`, `multi_edit`, `apply_patch`. |
| `path_escape`     | Path resolved outside the confined workspace root.           | Any path tool when `confineToWorkspace` is on.         |
| `monitor_not_found` | No monitor has the given `id` (it never existed or was stopped). | `monitor_poll`, `monitor_stop`.                  |
| `too_many_monitors` | `monitor_start` would exceed `maxMonitors` live monitors.  | `monitor_start`.                                       |
| `io_error`        | An underlying filesystem or process error.                   | Any tool; `bash` spawn failure.                        |
| `internal`        | Unexpected internal error (details logged to stderr, not returned). | Any tool.                                       |

## Handling them

- **Unknown / hidden tool → `not_found`.** Calling a tool that isn't registered — including a
  mutating tool while [`readOnly`](/guide/read-only-mode) is set — is a `not_found` error, not a
  thrown exception.
- **`ambiguous_match` / `no_match` are recoverable.** Feed the envelope back to the model so it can
  widen or narrow `old_string` and retry. See [`edit_file`](/reference/tools#edit_file).
- **`internal` never leaks details.** `serializeError` logs the stack to stderr and returns a generic
  `{ "error": "internal", "message": "internal error" }` — safe to surface to a caller.

## See also

- [Core API → Errors](/reference/core-api#errors) — `ToolError`, `serializeError`, `fsError`, `ErrorCode`
- [The tools](/reference/tools) — which codes each tool can return
- [createAgentTools → DispatchResult](/reference/create-agent-tools#dispatchresult) — how errors reach you
