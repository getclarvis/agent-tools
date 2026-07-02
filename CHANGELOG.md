# Changelog

All notable changes to `@clarvis/agent-tools` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/getclarvis/agent-tools/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/getclarvis/agent-tools/releases/tag/v0.1.0
