# @clarvis/agent-tools — Specification

This document specifies the behavior of each tool exposed by
`@clarvis/agent-tools`. For installation, configuration, and the
security model, see [README.md](./README.md).

## Conventions

- **Return value.** Each tool call returns `{ isError, content }`, where `content` is
  an array of parts: a text part `{ type: "text", text }` or an image part
  `{ type: "image", data, mimeType }` (`data` is base64). On failure `isError` is set
  and `content` is a single text part holding a JSON error object (see [Errors](#errors)).
- **Result format.** On success most tools return one text part. `bash` returns a
  single text part holding a JSON object (`exit_code`, `stdout`, `stderr`, `signal`,
  `timed_out`); a non-zero exit is a success (`isError` false), not an error. Only
  spawn/timeout/output-limit failures of `bash` flag `isError`. `read_image` returns
  one image part. The `monitor_*` tools each return one text part holding a JSON
  object. All failures, for every tool, are a text part with the JSON error
  object above.
- **Paths.** A path is resolved verbatim if absolute, otherwise against the
  workspace root. By default the result is **confined to the workspace root**:
  `../` traversal, absolute paths outside the root, and symlinks that resolve
  outside it are rejected with `path_escape` (the existing portion of the path is
  canonicalized with `realpath`, so symlink hops are caught). Confinement is
  disabled by `ALLOW_OUTSIDE_WORKSPACE=1` / `--allow-outside-workspace`, which
  restores unrestricted resolution (see README → Security).
- **Input size.** The file-reading tools (`read_file`, `edit_file`, `multi_edit`,
  `apply_patch`, and the in-process `grep` backend) refuse a file larger than
  `MAX_FILE_BYTES` (default 20000000): the read/edit tools fail with `too_large`,
  and `grep` skips the oversized file. `read_image` refuses a file larger than
  `MAX_IMAGE_BYTES` (default 5000000) with `too_large`.
- **Text & encoding.** Text tools operate on UTF-8. A UTF-16 file with a BOM (LE/BE)
  is decoded by `read_file`, but the editing tools refuse it (`is_binary`) rather than
  rewrite it as UTF-8. Other binary files (NUL byte in the first/last 8 KB, no UTF-16
  BOM) are rejected by the text tools with `is_binary`.
- **Line endings & BOM.** On read, content is normalized to `\n` for matching.
  On write, the editing tools (`edit_file`, `multi_edit`, `apply_patch` modify)
  **preserve each untouched line's original terminator** (`\r\n`, `\n`, or lone
  `\r`); newly inserted or edited lines use the file's dominant terminator. A
  leading UTF-8 BOM is preserved.
- **Output bounding.** Every text part is capped to `MAX_OUTPUT_BYTES` (default
  131072), truncated on a UTF-8 boundary with a trailing marker. Image parts are not
  text-bounded; `read_image` instead refuses a source larger than `MAX_IMAGE_BYTES`.
- **Atomicity.** All mutations write to a temp file and `rename` into place;
  multi-file operations (`apply_patch`) are staged and committed transactionally
  with rollback (a rename/move participates with both its source and destination). Writes to the same path are serialized by an in-process lock —
  this is the single-process contract; concurrent processes or external
  editors are **not** coordinated. A symlink target is refused (the link is not
  followed and not replaced).
- **BOM.** A leading U+FEFF is treated as a byte-order mark: stripped from the
  content returned by `read_file`/used for matching, and re-emitted on write.

## Read-only surface

In `--read-only` mode only `read_file`, `read_image`, `list_dir`, `glob`, `grep`,
`file_stat`, `tree`, `outline`, and `check_syntax` are exposed; the mutating tools are
not registered.

## Tree-sitter availability

`outline` and `check_syntax` require the optional `@vscode/tree-sitter-wasm` peer
dependency. Availability is probed once when the configuration is resolved
(`treeSitterAvailable`, injectable via `probeTreeSitter`); when the package is absent,
both tools are hidden from the full and read-only surfaces — calling them is
indistinguishable from calling an unknown tool (`not_found`) — and write results carry
no syntax warnings.

---

## read_file

Read a text file. UTF-8 by default; a UTF-16 file with a byte-order mark (LE/BE) is
detected and decoded.

**Input:** `path` (string, required); `offset` (integer, 1-based start line,
default 1; a negative value counts from the end — `-N` reads the last N lines; 0 is
invalid); `limit` (integer, max lines, default tool-defined).

**Behavior:** Returns lines prefixed with right-aligned line numbers and a tab.
Empty file returns `(empty file)`. Over-long lines are truncated with a marker, and no
single emitted line exceeds `MAX_OUTPUT_BYTES` (a longer line is byte-truncated on a UTF-8
boundary). At least one line is always shown. When more lines remain, a continuation hint
with the next `offset` is appended.

**Errors:** `not_found`, `not_a_file` (directory), `is_binary`, `too_large`,
`path_escape`, `invalid_input` (offset 0, or a positive offset past EOF).

## read_image

Read an image file and return it as an image part so a vision-capable model can view it.

**Input:** `path` (string, required).

**Behavior:** Reads the file's bytes (confined to the workspace, subject to
`MAX_IMAGE_BYTES`) and returns a single image part `{ type: "image", data, mimeType }`
where `data` is base64. The format is detected from the file's magic bytes; PNG, JPEG,
GIF, and WebP are supported. Produces no text part.

**Errors:** `not_found`, `not_a_file` (directory), `not_an_image` (unrecognized
format), `too_large` (larger than `MAX_IMAGE_BYTES`), `path_escape`.

## list_dir

List the entries of a directory.

**Input:** `path` (string, default workspace root).

**Behavior:** One entry per line; directories are marked. An empty directory
returns a sentinel line rather than an empty result.

**Errors:** `not_found`, `not_a_file` (path is a file), `path_escape`, `io_error`.

## glob

Find files (not directories) by glob pattern.

**Input:** `pattern` (string, required, e.g. `**/*.ts`); `path` (base dir,
default workspace root); `respect_gitignore` (boolean, default true).

**Behavior:** Returns matching file paths, most-recently-modified first. Hidden
files are included; when `respect_gitignore` is true, files ignored by the git
ignore stack and the `.git/` directory are skipped. No matches returns
`(no matches)`.

**Errors:** `not_found`, `path_escape`, `invalid_input` (bad glob).

## grep

Search file contents by regular expression, recursively.

**Input:** `pattern` (string, required, Rust/ripgrep regex syntax); `path` (file
or dir, default workspace root); `glob` (restrict to matching files);
`output_mode` (`files_with_matches` | `content` | `count`, default
`files_with_matches`); `ignore_case` (boolean, default false); `context`
(integer, both sides, content mode only, default 0); `before_context` /
`after_context` (integers, content mode only — `ripgrep` `-B`/`-A`; each overrides
`context` for that side); `head_limit` (integer ≥ 1, max results to return — files in
`files_with_matches`/`count`, matches in `content`; omit for unlimited, still
byte-bounded); `offset` (integer ≥ 0, 0-based number of leading results to skip —
**a result offset, not `read_file`'s line offset**); `multiline` (boolean, default
false — match across line boundaries, ripgrep `--multiline --multiline-dotall`).

**Behavior:** Uses ripgrep when available, otherwise an equivalent in-process
fallback. Both backends apply one consistent policy: **hidden files are
searched, the `.git/` directory is skipped, and the full git ignore stack is
respected** (nested `.gitignore`, parent directories up to the repository root,
`.git/info/exclude`, and the global excludes file). Binary files are skipped, as
are files larger than `MAX_FILE_BYTES` in the in-process backend. No matches
returns `(no matches)` (a success). Output is deterministic (sorted by path, then
line number). The pattern is validated by the active backend: ripgrep reports its
own syntax errors, and the in-process fallback compiles the pattern as a
JavaScript `RegExp`; a pattern valid for one engine but not the other is accepted
or rejected by whichever backend runs.

**Multiline.** With `multiline` true, `.` also matches newlines and `^`/`$` anchor at
line boundaries, so a single match may span several lines; in `content` mode it renders
as the spanned lines under the start line's `path:line:` prefix, and it still counts as
one match for `count` and as one unit for `head_limit`/`offset` paging. A match that
spans `\n` may differ between the two backends on CRLF files (the in-process backend
matches against `\n`-normalized text).

**Pagination.** `head_limit`/`offset` page over the result units (files, or matches in
content mode) **within the collected result window** — re-run with `offset` advanced to
get the next page. A footer reports state honestly: when the underlying scan was
truncated by the output cap it warns the result is **incomplete** and to narrow the
query (and does **not** suggest paging, since unscanned files cannot be reached);
otherwise, when more units remain it prints `showing A..B of N; call again with
offset=B for more`; an `offset` past the end on a complete scan returns
`(no results at offset N; M total)`.

**Errors:** `not_found`, `path_escape`, `invalid_input` (bad regex).

## file_stat

Return structured metadata for one path as a JSON object.

**Input:** `path` (string, required).

**Behavior:** `lstat`s the path (confined to the workspace) and returns one text part holding a JSON
object `{ path, type, size, mtime, mode, ... }`. `type` is `file`, `directory`, `symlink`, or `other`;
`mtime` is ISO-8601; `mode` is an octal string (e.g. `"0644"`). A symlink is reported **without being
followed** and includes `symlink_target`. For a regular file the object also carries `binary` (whether
the content looks binary) and `mime` (a detected image MIME type, else `null`); only a bounded head
slice is read, so `file_stat` works on files larger than `MAX_FILE_BYTES`.

**Errors:** `not_found`, `not_a_file` (never — a directory is a valid result), `path_escape`,
`io_error`.

## tree

Print a directory as an indented tree, recursively.

**Input:** `path` (string, default workspace root); `depth` (integer ≥ 1, max levels below the root;
omit for unlimited); `respect_gitignore` (boolean, default true).

**Behavior:** Walks the directory depth-first. Directories are rendered with a trailing `/`, symlinks
with a trailing `@`, and files with a byte size. Entries are ordered directories-first then by name.
When `respect_gitignore` is true, the full git ignore stack and the `.git/` directory are pruned (same
policy as `grep`/`glob`). **Symlinked directories are listed but not traversed** (cycle-safe). Output
is bounded to `MAX_OUTPUT_BYTES` with a truncation marker. An empty or fully-ignored directory prints
a `(no entries)` line under the root.

**Errors:** `not_found`, `not_a_file` (path is a file), `path_escape`, `io_error`.

## outline

Return the symbol skeleton of one source file. Requires the optional tree-sitter peer
dependency (see [Tree-sitter availability](#tree-sitter-availability)).

**Input:** `path` (string, required).

**Behavior:** Parses the file with the grammar picked by its extension and returns a
header line `<path> — <language>, <N> lines` followed by one indented line per declared
symbol (classes, functions, methods, and the other per-language declaration forms): two
spaces per nesting level, the declaration's first source line (trimmed, truncated to 150
chars, trailing `{`/`:` stripped), and a 1-based `(start-end)` line range. A file with no
symbols prints `(no symbols found)`. At most 2000 symbols are printed (a trailing
`[... N more symbols omitted ...]` line reports the rest); output is byte-bounded. A file
with syntax errors still produces an outline, plus a trailing `note:` recommending
`check_syntax`. Supported languages: typescript (`.ts`/`.mts`/`.cts`), tsx, javascript
(`.js`/`.mjs`/`.cjs`/`.jsx`), python, go, rust, java, c-sharp. Any other extension is
`invalid_input`. Input must be within `MAX_FILE_BYTES` and a 2000000-byte parse limit;
parsing is bounded by a 2-second budget (`timeout`).

**Errors:** `invalid_input` (unsupported extension), `not_found`, `not_a_file`
(directory), `is_binary`, `too_large`, `path_escape`, `timeout`, `aborted`, `io_error`,
`internal` (runtime failed to load despite a positive probe).

## check_syntax

Parse one source file and report syntax errors as JSON. Requires the optional
tree-sitter peer dependency (see [Tree-sitter availability](#tree-sitter-availability)).

**Input:** `path` (string, required).

**Behavior:** Parses the file with the grammar picked by its extension and returns one
text part holding `{ path, language, ok, errors, error_count, truncated }`. Each entry of
`errors` is `{ kind, line, column, near }`: `kind` is `error` (unparseable input; `near`
is the trimmed source line, truncated to 80 chars) or `missing` (a token the parser
expected but did not find; `near` is that token), with 1-based `line`/`column` (column in
UTF-16 code units — approximate for non-ASCII lines). At most 50 errors are reported;
`truncated: true` signals more. A pure parse check: `ok: true` means the file parses,
not that it type-checks or compiles. Every bundled grammar is supported — typescript,
tsx, javascript, python, go, rust, java, c-sharp, ruby, php, bash, css, ini, powershell,
and c/cpp (`.c`/`.h` are routed to the cpp grammar pragmatically). Same size and time
limits as `outline`.

**Errors:** `invalid_input` (unsupported extension), `not_found`, `not_a_file`
(directory), `is_binary`, `too_large`, `path_escape`, `timeout`, `aborted`, `io_error`,
`internal`.

## write_file

Create or overwrite a file with the given content (atomic).

**Input:** `path` (string, required); `content` (string, required).

**Behavior:** Writes `content` exactly. Missing parent directories are created.

**Syntax warning (all writing tools):** when tree-sitter is available and the written
file's extension has a grammar, `write_file`, `edit_file`, `multi_edit`, and
`apply_patch` append a
`warning: <language> syntax error in <file> at line N, column C (near|missing ...)` line
to their success message when the new content does not parse. Advisory only: the write
always succeeds; content over 1000000 bytes, files without a grammar, and slow parses
(over 1 second) are silently skipped, and `apply_patch` checks at most five written
files per patch.

**Errors:** `not_a_file`, `path_escape`, `io_error`.

## edit_file

Replace one exact occurrence of `old_string` with `new_string`.

**Input:** `path` (required); `old_string` (required, matched literally, without
read_file's line-number prefixes); `new_string` (required, must differ);
`replace_all` (boolean, default false).

**Behavior:** `old_string` is first matched **literally and exactly**, and must be
unique unless `replace_all` is set. When an exact match is **not** found (single-
replacement path only — `replace_all` stays exact-only), a **whitespace-tolerant
cascade** runs: it tries, strictest→loosest, an indentation-flexible, a per-line-
trimmed, an all-whitespace-collapsed, and finally a trimmed-substring match. It applies
**only when it resolves to exactly one region** (otherwise `ambiguous_match`, never a
guess); `new_string` is substituted verbatim (no re-indentation), and the result message
discloses that a tolerant match was used. Line endings/BOM are preserved per the
conventions above.

Note the verbatim substitution replaces the **whole matched region, including its original
leading indentation**, with `new_string` exactly as given. So a tolerant match can change a
line's indentation if `new_string` does not itself carry it — the disclosed result message
flags this and re-reading the file is recommended. (This is a deliberate trade-off: the tool
never guesses re-indentation.)

**Errors:** `no_match`, `ambiguous_match` (multiple exact or multiple tolerant
matches without `replace_all`), `invalid_input` (identical strings), `not_found`,
`is_binary`, `too_large`, `path_escape`.

## multi_edit

Apply several `edit_file`-style edits to ONE file in a single atomic call.

**Input:** `path` (required); `edits` (array of `{ old_string, new_string,
replace_all? }`, required).

**Behavior:** Edits run in order, each operating on the result of the previous, and
each inherits `edit_file`'s exact-then-whitespace-tolerant matching. The whole batch is
applied atomically; any failing edit aborts the call with its index and nothing is
written.

**Errors:** as `edit_file`, prefixed with the failing edit index.

## apply_patch

Apply a unified diff across one or more files atomically.

**Input:** `patch` (string, required, unified diff). A `/dev/null` source (`---`)
denotes a create and a `/dev/null` target (`+++`) a delete. A block whose old and new
paths differ is a **rename/move**: with hunks it moves and edits in one step, without
hunks (or with a content-reproducing hunk) it is a pure rename that preserves the file's
exact bytes.

**Behavior:** Each file block is validated and applied; all changes commit
together or roll back together (a rename participates with both its endpoints). Creating
an existing path, a rename whose destination already exists, or multiple blocks naming
the same path (including either endpoint of a rename), is rejected. Modified and
moved-and-edited files preserve line endings/BOM per the conventions; created files use
LF; a pure rename leaves the bytes and mode untouched. The file tools operate on UTF-8:
a UTF-16 file is **read** by `read_file` but the editing tools (`edit_file`,
`multi_edit`, `apply_patch`) refuse it (`is_binary`) rather than silently rewrite it as
UTF-8.

**Errors:** `patch_failed` (hunk did not apply; reports the file), `invalid_input`,
`not_found`, `not_a_file`, `is_binary`, `too_large`, `path_escape`, `io_error`.

## move

Move or rename one file (atomic). Regular files only.

**Input:** `source` (string, required); `destination` (string, required); `overwrite` (boolean,
default false).

**Behavior:** Resolves and confines both paths and serializes on both. Refuses a symlink at either
endpoint (`invalid_input`). `source` must exist (`not_found`) and be a regular file — a directory is
rejected with `not_a_file` (use `bash` for directory moves). If `destination` exists it must be a file
(`not_a_file` for a directory) and is refused unless `overwrite` is true (`invalid_input`); an
identical `source`/`destination` is also `invalid_input`. Missing parent directories of the
destination are created. The move is an atomic `rename` that preserves the file's bytes and permission
mode.

**Errors:** `not_found`, `not_a_file`, `invalid_input`, `path_escape`, `io_error`.

## copy

Copy one file (atomic, binary-safe). Regular files only.

**Input:** `source` (string, required); `destination` (string, required); `overwrite` (boolean,
default false).

**Behavior:** Same path resolution, locking, symlink refusal, and existence/overwrite semantics as
`move`. The copy is published atomically (staged in the destination directory, then renamed into
place) and copies the bytes exactly (binary-safe), preserving the source's permission mode. Unlike the
text tools, `copy` imposes no `MAX_FILE_BYTES` limit — it is a streaming copy, not an in-memory read.
The source is left in place.

**Errors:** `not_found`, `not_a_file`, `invalid_input`, `path_escape`, `io_error`.

## mkdir

Create a directory, including missing parents (`mkdir -p`).

**Input:** `path` (string, required).

**Behavior:** Creates the directory and any missing parent directories. Idempotent — succeeds if the
directory already exists. A path that already exists as a file, or whose parent component is a file, is
rejected with `not_a_file`.

**Errors:** `not_a_file`, `path_escape`, `io_error`.

## remove

Delete one file. Regular files only.

**Input:** `path` (string, required).

**Behavior:** Deletes a regular file atomically. A missing path is `not_found`; a directory is
`not_a_file` (use `bash` for recursive directory removal); a symlink is refused (`invalid_input`,
the link is not followed).

**Errors:** `not_found`, `not_a_file`, `invalid_input`, `path_escape`, `io_error`.

## bash

Run a shell command via `sh -c` and return stdout, stderr, and exit code.

**Input:** `command` (string, required); `cwd` (string, default workspace root);
`timeout_ms` (integer, default `BASH_TIMEOUT_MS` = 120000; may be raised up to
`BASH_TIMEOUT_MAX_MS` = 600000 for a long build/test/install — a larger request is
clamped to the ceiling, not rejected).

**Behavior:** The command runs to completion and **blocks** until it exits;
stdin is closed. A long-lived process (dev server, watcher) must be backgrounded
with its output redirected, e.g. `npm start > /tmp/out.log 2>&1 &`. On success
the result is a JSON object `{ exit_code, stdout, stderr, signal, timed_out }`.
A non-zero exit is a normal result, not an error.

stdout and stderr are budgeted against a shared `MAX_OUTPUT_BYTES`; overflow is
written to a `.clarvis/` spill file referenced in the result. There is a hard
per-stream in-memory ceiling: a command producing unbounded output is killed
(process group) and the call fails with `output_limit`.

On timeout the process group is killed and `timeout` is returned (with the
partial stdout/stderr).

**Errors:** `timeout`, `aborted` (cancelled via the dispatch `AbortSignal`),
`output_limit`, `not_found`/`not_a_file` (bad `cwd`), `path_escape` (`cwd` outside
the workspace), `io_error` (spawn failure).

---

## monitor_start / monitor_poll / monitor_stop / monitor_list

Standardized background-process monitors. `bash` blocks until a command exits; a
monitor is its complement for a command that does not — a dev server, `tail -f`, a
watcher. A monitor holds no state in-process: each call re-derives the truth from
`.clarvis/monitor-<id>.{json,log,exit}` sidecars and the live OS process, so it is
as stateless as the file tools.

**monitor_start** — Launch `command` (string, required) via `sh -c` in the
background, its combined stdout+stderr appended to `.clarvis/monitor-<id>.log`.
`cwd` (string, default workspace root). Returns immediately with
`{ id, running, ready, output, next_offset }`. If `ready_when` (a regex) is given
the call **blocks** until the log matches it — or until `ready_timeout_ms` (default
`MONITOR_READY_TIMEOUT_MS` = 30000) elapses, or the process exits — and `ready`
reports whether the match was seen (`null` when no `ready_when` was given).
`ready_when` is tested against the first `MAX_OUTPUT_BYTES` of output, so a marker
printed only after that much startup chatter is not detected. Do
**not** background inside the command (a trailing `&`): the monitor backgrounds it
for you, and a stray `&` makes the id track the wrong process. At most
`MAX_MONITORS` (default 32) live monitors may exist at once; beyond that
`monitor_start` fails with `too_many_monitors`.

**monitor_poll** — Read new output from monitor `id` (string, required) since a
byte `offset` (integer ≥ 0, default 0). Returns
`{ running, output, next_offset, exit_code }`: pass `next_offset` back to page
forward. `match` (a regex) keeps only matching lines. `exit_code` is the command's
natural exit code once it has exited on its own — `null` while running, and `null`
if the monitor was stopped or killed. Output is bounded to `MAX_OUTPUT_BYTES`; while
the process is still running and `match` is not set, a partial trailing line is held
back so a line is not split across polls. (With `match`, or when the byte cap
truncates the slice, a line may span two polls.)

**monitor_stop** — Stop monitor `id` (string, required): signal its process group
(SIGTERM, then SIGKILL after a short grace) and remove its sidecars. Idempotent —
stopping an already-exited monitor just cleans up. Returns `{ stopped, id }`.

**monitor_list** — Return
`{ monitors: [ { id, command, running, started_at, cwd } ] }` for every monitor
(running and finished), newest first. Use it to find and stop leaked monitors.

**Errors:** `monitor_not_found` (unknown `id`), `too_many_monitors` (`MAX_MONITORS`
reached), `invalid_input` (bad `ready_when`/`match` regex), `not_found`/`not_a_file`
(bad `cwd`), `path_escape` (`cwd` outside the workspace), `io_error` (spawn
failure).

**Reaping.** A monitor's process outlives the call and survives host exit, so a
forgotten monitor leaks (the same exec exposure as `bash`, not a sandbox).
`sweepMonitors(workspaceRoot)` (companion to `sweepSpillDir`) removes the sidecars
of monitors whose process has exited, leaving live ones untouched — call it at
session start. `exit_code` is captured for a natural exit only; a command that
`exec`s away or is killed leaves `exit_code` null.

---

## Errors

Errors are returned as a JSON object `{ "error": <code>, "message": <string>, ...fields }`.
The codes are:

| Code              | Meaning                                                    |
| ----------------- | --------------------------------------------------------- |
| `invalid_input`   | Arguments failed schema or semantic validation.           |
| `not_found`       | Path does not exist.                                       |
| `not_a_file`      | Path was a directory where a file was expected (or vice). |
| `is_binary`       | File appears to be binary; text tools refuse it.          |
| `not_an_image`    | File is not a supported image format (`read_image`).      |
| `no_match`        | `edit_file`/`multi_edit` could not find `old_string`.     |
| `ambiguous_match` | `old_string` matched more than once without `replace_all`.|
| `patch_failed`    | A patch hunk did not apply cleanly.                       |
| `timeout`         | `bash` command exceeded its timeout.                      |
| `aborted`         | `bash` run cancelled via the dispatch `AbortSignal`.      |
| `output_limit`    | `bash` output exceeded the hard capture ceiling.          |
| `too_large`       | Input file exceeded `MAX_FILE_BYTES`.                     |
| `path_escape`     | Path resolved outside the confined workspace root.        |
| `monitor_not_found` | No monitor with the given id (`monitor_poll`/`stop`).   |
| `too_many_monitors` | `monitor_start` would exceed `MAX_MONITORS` live monitors.|
| `io_error`        | An underlying filesystem/process error.                   |
| `internal`        | Unexpected internal error.                                |
