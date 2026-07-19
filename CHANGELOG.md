# Changelog

All notable changes to `@clarvis/agent-tools` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`maxBashOutputBytes` — a separate, smaller inline cap for `bash` output.** `bash` stdout/stderr
  are now budgeted against their own cap (default **16 KB**, floor `1024`, overridable via the
  `MAX_BASH_OUTPUT_BYTES` env var) instead of sharing the 128 KB `maxOutputBytes`. Command logs are
  far noisier than a file the model deliberately read, so the inline view stays tight while the full
  output is still spilled to `.clarvis/`. The default is exported as `DEFAULT_MAX_BASH_OUTPUT_BYTES`.

### Changed

- **`bash` spill keeps the tail, not the head.** When a completed command's output overflows the cap,
  the inline result now keeps the **end** of the stream — where errors and summaries live — behind a
  marker naming the spill file, rather than the beginning. The full output is still written to the
  `.clarvis/` spill file unchanged, and the cut stays UTF-8-safe (never splits a multibyte character).

### Fixed

- **Guard: redirection targets are now extracted as paths.** A redirection target written without a
  space after the operator (e.g. `>/etc/cron.d/x`) was tokenized as a single `>/etc/cron.d/x` token
  and dropped by path analysis, so it never reached `BashFacts.paths`. With an `allowed_commands`
  allowlist configured, an allowed command could then redirect-write outside the workspace and the
  guard returned `allow`. `analyzeBash` now peels a leading redirection operator (`>`, `>>`, `2>`,
  `&>`, `<`, glued or spaced) so the target is analyzed as the path it writes to.

## [0.5.0]

### Changed

- **Relaxed input validation for LLM ergonomics.** Three changes that make the tools more forgiving
  of the ways LLMs actually call them, without changing any successful-call behavior:
  - **`coerceTypes: true` on the AJV validator.** String-encoded numbers/booleans (e.g.
    `multiline: "true"` instead of `true`, `limit: "100"` instead of `100`) are now coerced to the
    declared type before validation, instead of being rejected as `invalid_input`.
  - **Removed `additionalProperties: false` from all tool schemas.** Extra/unknown fields in a
    tool-call argument object are now silently ignored (handlers only read named fields), instead of
    being rejected as `invalid_input`. This is the most common cause of hard rejections in
    grammar-constrained decoders that emit superfluous keys.
  - **Lowered `minimum: 1` to `minimum: 0` on `grep.head_limit`, `tree.depth`, `bash.timeout_ms`,
    `monitor.ready_timeout_ms`, and `read_file.limit`.** A value of `0` is now treated the same as
    omitting the field (falls back to the default), instead of being rejected.

### Fixed

- **`tree.depth: 0` no longer behaves like `depth: 1`.** Previously `depth: 0` listed only the
  immediate children of the root (identical to `depth: 1`) due to a missing `||` coercion. Now
  `depth: 0` is treated as "unlimited depth", consistent with omitting the field and with the other
  numeric limits that use the same `||` pattern.

## [0.4.1]

### Fixed

- **Dropped `minLength: 1` from `multi_edit`'s nested `edits[].old_string` schema.** A `minLength`
  on a string nested inside an array-of-objects drives some grammar-constrained decoders (guided
  JSON on OpenAI-compatible gateways, e.g. DeepInfra serving GLM) to emit corrupted tool-call
  argument strings — backticks, hallucinated ternaries, placeholder tokens (`%LINEBREAK%`, `{q}`),
  stray `omitempty`, mangled class names — so the `old_string` never matches and the edit loops on
  `no_match`. Isolation across the same model showed the corruption vanishes the moment this one
  keyword is removed; the flat `edit_file` schema is unaffected and keeps its `minLength`. The
  empty-`old_string` rejection is now enforced at runtime (`invalid_input`, with the edit index).

## [0.4.0]

### Added

- **Structured `meta.diff` on the editing tools.** `edit_file`, `multi_edit`, `write_file` (on
  overwrite), and `replace` (on apply) now carry a real unified diff of the change (true line numbers,
  three lines of context) on the result's `meta.diff` — a sidecar for a client to render, never shown
  to the model. The model-facing `content` stays the short prose summary. Absent when there is nothing
  to compare (a brand-new `write_file`, or an overwrite whose prior content is binary/unreadable).
- **`DispatchResult.meta`.** Dispatch results gain an optional `meta` field, and a `ToolDef.handler`
  may now return a `ToolResult` (`{ content, meta? }`) in addition to a bare `string`. `ToolResult`
  is exported from the package root.

### Changed

- **`ToolDef.handler` return type narrowed to `string | ToolResult`** (was `string | ContentPart[]`).
  A handler that produced content parts directly (e.g. `read_image`) now wraps them in a `ToolResult`
  (`{ content: [...] }`). `dispatch` / `callTool` consumers are unaffected: the `DispatchResult` shape
  is unchanged apart from the additive `meta`.

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
- **`outline` tool.** Return the symbol skeleton of one source file — classes, functions, methods
  and other declarations as indented lines with 1-based `(start-end)` line ranges — so an agent can
  understand an unfamiliar file cheaply and then read only the relevant ranges. Supports
  typescript, tsx, javascript, python, go, rust, java and c-sharp (picked by file extension).
  Available in the read-only surface.
- **`check_syntax` tool.** Parse one source file with tree-sitter and report syntax errors (parser
  `ERROR`/`MISSING` nodes) as JSON with 1-based line/column, a kind, and a nearby excerpt. A pure
  parse check — no type-checking or linting. Language picked by file extension; covers every
  bundled grammar (the eight outline languages plus ruby, php, bash, css, ini, powershell and
  c/cpp via the cpp grammar). Available in the read-only surface.
- **Syntax warnings on writes.** When tree-sitter is available, `write_file`, `edit_file`,
  `multi_edit` and `apply_patch` append a
  `warning: <language> syntax error in <file> at line N, column C ...` line to their success
  result when the written content no longer parses (advisory only — the write always succeeds;
  `apply_patch` checks at most five files per patch).
- **Optional `@vscode/tree-sitter-wasm` peer dependency.** `outline`, `check_syntax` and the write
  warnings activate only when the host installs `@vscode/tree-sitter-wasm` (prebuilt WASM runtime +
  grammars, MIT); when absent, the two tools are hidden from the surface — indistinguishable from
  unknown tools — and writes are unannotated. Availability is probed once at config resolution
  (`treeSitterAvailable`, injectable via `probeTreeSitter`), so the core install stays lean.
- **`read_files` tool.** Read up to 64 text files in a single call, each rendered like `read_file`
  (numbered lines) under a `==> <path> <==` header. A failing path becomes an inline error line
  without failing the batch; the combined output is bounded, dropping later files with a marker when
  the budget runs out. Available in the read-only surface.
- **`diff` tool.** Unified diff between two workspace text files, without git — line endings are
  normalized before comparison, and identical content yields `(no differences)`. Available in the
  read-only surface.
- **`replace` tool.** Project-wide regex find/replace, preview-first: `dry_run` defaults to true and
  returns match counts plus a unified-diff preview; `dry_run: false` applies every edit atomically
  (all files or none) under per-file locks, preserving line endings and BOM, and can carry syntax
  warnings for up to five files. Scoped by `path` and/or `glob`, honors the git ignore stack, skips
  binary/oversized files, refuses to write through a symlink, and rejects a pattern that matches the
  empty string. Replaces the `sed -i`-via-`bash` pattern with a confined, guardable, atomic operation.

No new error codes: the new tools reuse `invalid_input` (unsupported extension), `not_found`,
`not_a_file`, `is_binary`, `too_large` (a 2 MB parse limit), `path_escape`, `timeout`, `aborted`,
`io_error`, and `internal`; the four fs tools reuse `invalid_input` (existing destination, symlink,
identical paths), `not_found`, `not_a_file`, `path_escape`, and `io_error`.

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

[Unreleased]: https://github.com/getclarvis/agent-tools/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/getclarvis/agent-tools/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/getclarvis/agent-tools/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/getclarvis/agent-tools/compare/v0.1.1...v0.2.0
[0.1.0]: https://github.com/getclarvis/agent-tools/releases/tag/v0.1.0
