# Changelog

All notable changes to `@clarvis/agent-tools` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0]

### Added

- **`move` tool.** Move or rename one regular file (atomic `rename`), creating missing destination
  parent directories and preserving the file's permission mode. Refuses an existing destination
  unless `overwrite: true`, refuses a directory source (files only — use `bash` for directories),
  and refuses to act through a symlink.
- **`copy` tool.** Copy one regular file, binary-safe, published atomically (staged in the
  destination directory then renamed) with the source's mode preserved. Same overwrite / files-only /
  symlink semantics as `move`; imposes no `MAX_FILE_BYTES` limit (it is a streaming copy).
- **`mkdir` tool.** Create a directory and any missing parents (`mkdir -p`); idempotent, and
  `not_a_file` if the path already exists as a file.
- **`remove` tool.** Delete one regular file; `not_found` on a missing path, `not_a_file` on a
  directory (use `bash` for recursive removal), and refuses to delete through a symlink.
- **`file_stat` tool.** Return structured metadata for a path as a JSON object
  (`type`/`size`/`mtime`/`mode`, plus `symlink_target` for symlinks and `binary`/`mime` for files).
  Reads only a bounded head slice, so it works on files larger than `MAX_FILE_BYTES`. Available in
  the read-only surface.
- **`tree` tool.** Print a directory as an indented, gitignore-aware tree (`depth`-limited,
  symlinked directories listed but not traversed, output byte-bounded). Available in the read-only
  surface.

No new error codes or config knobs: the four mutating tools reuse `invalid_input` (existing
destination, symlink, identical paths), `not_found`, `not_a_file`, `path_escape`, and `io_error`.

## [0.2.0]

### Changed

- **BREAKING: tool results are now content parts.** `DispatchResult.text: string` is
  replaced by `DispatchResult.content: ContentPart[]` — a `TextPart` (`{ type: "text", text }`)
  or an `ImagePart` (`{ type: "image", data, mimeType }`, `data` base64) — aligning with the
  content-block model common to modern agent/tool APIs and letting a tool return an image. Tool
  handlers may still return a plain `string` (sugar for a single text part). Errors are
  unchanged in spirit: `isError` is set and the message rides a single text part. Consumers
  that read `.text` must read `.content` (text parts carry the text).

### Added

- **`read_image` tool.** Reads an image file (PNG, JPEG, GIF, or WebP), validated by magic
  bytes, and returns it as a base64 image part a vision-capable model can view. Available in
  the read-only surface. Refuses non-image files (`not_an_image`) and files larger than
  `MAX_IMAGE_BYTES`.
- **`maxImageBytes` / `MAX_IMAGE_BYTES`** config knob (default 5000000) bounding the size of
  a file `read_image` will load; exported `DEFAULT_MAX_IMAGE_BYTES`.
- Public content-part types `ContentPart`, `TextPart`, and `ImagePart`, plus a
  `contentText(content)` helper that concatenates the text parts of a result.
- **Background process monitors — `monitor_start`, `monitor_poll`, `monitor_stop`, and
  `monitor_list`.** `bash` blocks until a command exits; a monitor is its complement for
  commands that do not — a dev server, `tail -f`, a watcher. `monitor_start` launches a command
  in the background (its combined stdout/stderr streamed to a `.clarvis/monitor-<id>.log`) and
  returns an id immediately, optionally blocking until the output matches a `ready_when` regex.
  `monitor_poll` reads new output since a byte offset (with an optional `match` regex filter) and
  reports whether the process is still running plus its natural exit code. `monitor_stop` signals
  the process group (SIGTERM, then SIGKILL) and cleans up; `monitor_list` surfaces every monitor
  so leaked ones can be found and stopped. These tools hold no state in-process: each call
  re-derives the truth from the `.clarvis/` sidecars and the live OS process.
- **`monitorReadyTimeoutMs` / `MONITOR_READY_TIMEOUT_MS`** (default 30000) and **`maxMonitors` /
  `MAX_MONITORS`** (default 32) config knobs, with exported `DEFAULT_MONITOR_READY_TIMEOUT_MS`
  and `DEFAULT_MAX_MONITORS`; new error codes `monitor_not_found` and `too_many_monitors`.
- **`sweepMonitors(workspaceRoot)`** — a liveness-aware reaper (companion to `sweepSpillDir`)
  that removes the sidecars of monitors whose process has exited, leaving live ones untouched.

## [0.1.1]

### Added

- **Cooperative cancellation.** `dispatch(name, args, config, signal?)` now accepts an optional
  `AbortSignal` and threads it into each `ToolDef.handler(args, config, signal?)`. `bash` honors it:
  when the signal aborts, the whole spawned process group is `SIGKILL`ed and the call rejects with a
  new `aborted` error code — so a cancelled run no longer leaves a long-running command running (or
  the caller blocked) until the command's own timeout.

## [0.1.0] - 2026-07-01

Initial public release.

### Added

- **Nine coding tools** for driving an LLM agent over a workspace: `read_file`, `list_dir`, `glob`,
  `grep`, `write_file`, `edit_file`, `multi_edit`, `apply_patch`, and `bash`.
- **Transport-agnostic library API** — `createAgentTools({ workspaceRoot })` plus the lower-level
  `dispatch` / `listTools` / `resolveConfig` / `buildConfig` and the raw `ToolDef` registry
  (`tools`, `readOnlyTools`, `getTool`, `selectSurface`).
- **Uniform dispatch pipeline** — arguments validated against each tool's JSON Schema (ajv), handler
  run, output bounded, and errors serialized to a stable `{ error, message, ...fields }` envelope
  (`ToolError`, `serializeError`, `fsError`, the `ErrorCode` union).
- **Workspace path confinement** (`confineToWorkspace`, default on) with `realpath` canonicalization
  and symlink-escape rejection (`path_escape`), plus write-through-symlink refusal.
- **Read-only mode** (`readOnly`) exposing only `read_file`, `list_dir`, `glob`, and `grep`.
- **Output bounding & spill** — every result capped to `maxOutputBytes` (UTF-8-safe); `bash` splits
  the budget across stdout/stderr, enforces a per-stream capture ceiling (`output_limit`), and spills
  full output to a `.clarvis/` file, swept by `sweepSpillDir`.
- **Atomic writes** — temp-then-rename with fsync, mode preservation, per-path locking, and
  multi-file rollback for `apply_patch`.
- **Text handling** — UTF-8 / UTF-16 (LE/BE) decoding, BOM and per-line EOL preservation on edits,
  NUL-byte binary rejection, and a `maxFileBytes` input ceiling (`too_large`).
- **grep** backed by ripgrep when available, with a behaviorally consistent in-process fallback, both
  honoring `.gitignore`.
- **VitePress documentation site** ([agent-tools.clarvis.dev](https://agent-tools.clarvis.dev)) and
  the canonical per-tool [`SPEC.md`](SPEC.md).

[Unreleased]: https://github.com/getclarvis/agent-tools/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/getclarvis/agent-tools/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/getclarvis/agent-tools/compare/v0.1.1...v0.2.0
[0.1.0]: https://github.com/getclarvis/agent-tools/releases/tag/v0.1.0
