# The tools

> The twenty tools, their inputs, outputs, and error codes. Seven are available in read-only mode;
> the other thirteen require the full surface. In [read-only mode](/guide/read-only-mode) only the read
> tools are registered. This mirrors the canonical
> [`SPEC.md`](https://github.com/getclarvis/agent-tools/blob/main/SPEC.md) in the repo.

| Tool                          | Mutating | Summary                                                            |
| ----------------------------- | -------- | ------------------------------------------------------------------ |
| [`read_file`](#read_file)     | no       | Read a text file (UTF-8/UTF-16), with line numbers, paging, tail.  |
| [`read_image`](#read_image)   | no       | Read an image (PNG/JPEG/GIF/WebP) as a base64 image part.          |
| [`list_dir`](#list_dir)       | no       | List the entries of a directory.                                   |
| [`glob`](#glob)               | no       | Find files by glob, most-recently-modified first.                  |
| [`grep`](#grep)               | no       | Search file contents by regular expression (optionally multiline). |
| [`file_stat`](#file_stat)     | no       | Structured metadata for a path (type, size, mtime, mode) as JSON.  |
| [`tree`](#tree)               | no       | Print a directory as an indented, gitignore-aware tree.            |
| [`write_file`](#write_file)   | yes      | Create or overwrite a file (atomic).                               |
| [`edit_file`](#edit_file)     | yes      | Replace one exact occurrence of a string in a file.                |
| [`multi_edit`](#multi_edit)   | yes      | Apply several `edit_file`-style edits to one file atomically.      |
| [`apply_patch`](#apply_patch) | yes      | Apply a unified diff (modify/create/delete/rename) atomically.     |
| [`move`](#move)               | yes      | Move/rename one file (atomic).                                     |
| [`copy`](#copy)               | yes      | Copy one file, binary-safe (atomic).                              |
| [`mkdir`](#mkdir)             | yes      | Create a directory and missing parents.                           |
| [`remove`](#remove)           | yes      | Delete one file.                                                   |
| [`bash`](#bash)               | yes      | Run a shell command (`sh -c`) and capture stdout/stderr/exit.      |
| [`monitor_start`](#monitor_start) | yes  | Start a background command (dev server, watcher); return an id, optionally waiting until ready. |
| [`monitor_poll`](#monitor_poll)   | yes  | Read a monitor's new output since a byte offset; report running state and exit code.            |
| [`monitor_stop`](#monitor_stop)   | yes  | Stop a monitor (SIGTERM→SIGKILL) and remove its files.                                          |
| [`monitor_list`](#monitor_list)   | yes  | List running and finished monitors.                                                             |

Every failure is a JSON [error envelope](/reference/error-codes). Success is plain text for most
tools; `bash` and the `monitor_*` tools return a JSON object, and `read_image` returns a base64 image
part.

## read_file

Read a text file. UTF-8 by default; a UTF-16 file with a byte-order mark (LE/BE) is detected and
decoded (but the editing tools refuse it — see [Text & encoding](/explanation/text-and-encoding)).

| Input    | Type    | Required | Default | Notes                                                                                             |
| -------- | ------- | -------- | ------- | ------------------------------------------------------------------------------------------------- |
| `path`   | string  | yes      | —       | File to read.                                                                                     |
| `offset` | integer | no       | `1`     | 1-based start line. A negative value counts from the end (`-N` reads the last N lines); `0` is invalid. |
| `limit`  | integer | no       | `2000`  | Maximum lines to return.                                                                           |

**Output.** Lines prefixed with right-aligned line numbers and a tab. An empty file returns
`(empty file)`. Over-long lines are truncated with a marker. When more lines remain, a continuation
hint with the next `offset` is appended.

**Errors.** `not_found`, `not_a_file`, `is_binary`, `too_large`, `path_escape`, `invalid_input`
(offset `0`, or a positive offset past EOF).

## read_image

Read an image file and return it as an image part so a vision-capable model can view it. Produces no
text part.

| Input  | Type   | Required | Default | Notes          |
| ------ | ------ | -------- | ------- | -------------- |
| `path` | string | yes      | —       | Image to read. |

**Output.** A single image part `{ type: "image", data, mimeType }` where `data` is base64. The format
is detected from the file's magic bytes; PNG, JPEG, GIF, and WebP are supported. The source is confined
to the workspace and refused if larger than `maxImageBytes` (default 5 MB).

**Errors.** `not_found`, `not_a_file` (directory), `not_an_image` (unrecognized format), `too_large`
(larger than `maxImageBytes`), `path_escape`.

## list_dir

List the entries of a directory (non-recursive).

| Input  | Type   | Required | Default        | Notes                 |
| ------ | ------ | -------- | -------------- | --------------------- |
| `path` | string | no       | workspace root | Directory to list.    |

**Output.** One entry per line; directories are marked. An empty directory returns a sentinel line
rather than an empty result.

**Errors.** `not_found`, `not_a_file` (path is a file), `path_escape`, `io_error`.

## glob

Find files (not directories) by glob pattern.

| Input               | Type    | Required | Default        | Notes                                                          |
| ------------------- | ------- | -------- | -------------- | -------------------------------------------------------------- |
| `pattern`           | string  | yes      | —              | Glob pattern, e.g. `**/*.ts`.                                  |
| `path`              | string  | no       | workspace root | Base directory to search from.                                 |
| `respect_gitignore` | boolean | no       | `true`         | Skip files ignored by the git ignore stack, and the `.git/` dir.|

**Output.** Matching file paths, most-recently-modified first. Hidden files are included. No matches
returns `(no matches)` (a success, not an error).

**Errors.** `not_found`, `path_escape`, `invalid_input` (bad glob).

## grep

Search file contents by regular expression, recursively. Uses ripgrep when available, otherwise an
equivalent in-process fallback; both apply one consistent policy (hidden files searched, `.git/`
skipped, the full git ignore stack respected, binary and oversized files skipped).

| Input            | Type    | Required | Default              | Notes                                                                                     |
| ---------------- | ------- | -------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `pattern`        | string  | yes      | —                    | Regex (Rust/ripgrep syntax).                                                              |
| `path`           | string  | no       | workspace root       | File or directory to search.                                                              |
| `glob`           | string  | no       | —                    | Restrict to files matching this glob.                                                     |
| `output_mode`    | enum    | no       | `files_with_matches` | `files_with_matches` \| `content` \| `count`.                                             |
| `ignore_case`    | boolean | no       | `false`              | Case-insensitive matching.                                                                |
| `multiline`      | boolean | no       | `false`              | Match across line boundaries (`.` spans `\n`, `^`/`$` at line bounds).                     |
| `context`        | integer | no       | `0`                  | Context lines both sides (content mode only).                                             |
| `before_context` | integer | no       | —                    | Lines before each match (content mode); overrides `context` for that side.                |
| `after_context`  | integer | no       | —                    | Lines after each match (content mode); overrides `context` for that side.                 |
| `head_limit`     | integer | no       | —                    | Max results to return (files, or matches in content mode). ≥ 1; omit for unlimited.       |
| `offset`         | integer | no       | `0`                  | 0-based number of **results** to skip — a result offset, not `read_file`'s line offset.   |

**Output.** `files_with_matches` prints one file path per line; `content` prints `path:line:text`
(with context if requested); `count` prints `path:N`. No matches returns `(no matches)`. Output is
deterministic (sorted by path, then line). `head_limit`/`offset` page over the collected results; a
footer reports state honestly (`showing A..B of N; call again with offset=B for more`), or warns that
the scan was **incomplete** when it was cut off by the output cap.

**Errors.** `not_found`, `path_escape`, `invalid_input` (bad regex).

## file_stat

Return structured metadata for one path, as a JSON object — inspect a path before reading it.

| Input  | Type   | Required | Default | Notes             |
| ------ | ------ | -------- | ------- | ----------------- |
| `path` | string | yes      | —       | Path to inspect.  |

**Output.** A JSON object `{ path, type, size, mtime, mode, ... }` where `type` is
`file` \| `directory` \| `symlink` \| `other`, `mtime` is ISO-8601, and `mode` is an octal string
(e.g. `"0644"`). A symlink is reported **without being followed**, with a `symlink_target`. For a
regular file it also reports `binary` (whether the content looks binary) and `mime` (an image MIME
type or `null`), reading only a small head slice — so it works on files too large to read.

**Errors.** `not_found`, `path_escape`, `io_error`.

## tree

Print a directory as an indented tree — directories end with `/`, symlinks with `@`, and files show
a byte size.

| Input               | Type    | Required | Default        | Notes                                                           |
| ------------------- | ------- | -------- | -------------- | --------------------------------------------------------------- |
| `path`              | string  | no       | workspace root | Root directory of the tree.                                     |
| `depth`             | integer | no       | unlimited      | Maximum levels to descend below the root (≥ 1).                 |
| `respect_gitignore` | boolean | no       | `true`         | Skip files ignored by the git ignore stack, and the `.git/` dir.|

**Output.** An indented ASCII tree rooted at `path`. Symlinked directories are **listed but not
traversed** (cycle-safe). Output is byte-bounded like `grep`/`read_file`. An empty (or fully ignored)
directory prints a `(no entries)` line.

**Errors.** `not_found`, `not_a_file` (path is a file), `path_escape`, `io_error`.

## write_file

Create or overwrite a file with the given content (atomic: temp file + `rename`).

| Input     | Type   | Required | Notes                              |
| --------- | ------ | -------- | ---------------------------------- |
| `path`    | string | yes      | Destination.                       |
| `content` | string | yes      | Full content to write, exactly.    |

**Output.** A success message with the byte count and whether the file was created or overwritten.
Parent directories must already exist.

**Errors.** `not_found` (missing parent), `not_a_file`, `path_escape`, `io_error`.

## edit_file

Replace one occurrence of `old_string` with `new_string`.

| Input         | Type    | Required | Default | Notes                                                                    |
| ------------- | ------- | -------- | ------- | ------------------------------------------------------------------------ |
| `path`        | string  | yes      | —       | File to edit.                                                            |
| `old_string`  | string  | yes      | —       | Text to find, matched literally (no regex, no line-number prefixes).     |
| `new_string`  | string  | yes      | —       | Replacement; must differ from `old_string`.                             |
| `replace_all` | boolean | no       | `false` | Replace every exact occurrence instead of requiring a unique one.        |

**Matching.** `old_string` is matched **literally and exactly** first, and must be unique unless
`replace_all` is set. When an exact match is not found (single-replacement path only), a
**whitespace-tolerant cascade** runs — strictest→loosest: indentation-flexible, per-line-trimmed,
all-whitespace-collapsed, then trimmed-substring. It applies **only if it resolves to exactly one
region** (otherwise `ambiguous_match`, never a guess), and the success message discloses that a
tolerant match was used. Line endings and BOM are preserved.

**Errors.** `no_match`, `ambiguous_match`, `invalid_input` (identical strings), `not_found`,
`is_binary`, `too_large`, `path_escape`.

## multi_edit

Apply several `edit_file`-style edits to ONE file in a single atomic call.

| Input   | Type  | Required | Notes                                                                          |
| ------- | ----- | -------- | ------------------------------------------------------------------------------ |
| `path`  | string| yes      | File to edit.                                                                  |
| `edits` | array | yes      | At least one `{ old_string, new_string, replace_all? }`; applied in order.     |

**Behavior.** Edits run in order, each operating on the result of the previous, and each inherits
`edit_file`'s exact-then-tolerant matching. The whole batch is applied atomically; any failing edit
aborts the call — nothing is written — and the error names the failing edit index.

**Errors.** As [`edit_file`](#edit_file), prefixed with the failing edit index.

## apply_patch

Apply a unified diff across one or more files atomically.

| Input   | Type   | Required | Notes                                        |
| ------- | ------ | -------- | -------------------------------------------- |
| `patch` | string | yes      | A unified diff spanning one or more files.   |

**Behavior.** A `/dev/null` source (`---`) denotes a create; a `/dev/null` target (`+++`) a delete; a
block whose old and new paths differ is a rename/move (with hunks it moves and edits in one step;
without them it is a pure rename that preserves the exact bytes). Each file block is validated and
applied; all changes commit together or roll back together. Creating an existing path, renaming onto
an existing destination, or naming the same path twice is rejected. Modified files preserve line
endings and BOM; created files use LF.

**Errors.** `patch_failed` (a hunk did not apply; names the file), `invalid_input`, `not_found`,
`not_a_file`, `is_binary`, `too_large`, `path_escape`, `io_error`.

## move

Move or rename one file (atomic `rename`). Files only — a directory source is rejected; use `bash`
for directory moves.

| Input         | Type    | Required | Default | Notes                                                     |
| ------------- | ------- | -------- | ------- | --------------------------------------------------------- |
| `source`      | string  | yes      | —       | File to move.                                             |
| `destination` | string  | yes      | —       | New path. Missing parent directories are created.        |
| `overwrite`   | boolean | no       | `false` | When true, replace an existing destination file.          |

**Output.** A success message naming the source and destination. Refuses (`invalid_input`) if the
destination already exists unless `overwrite` is true, and if `source` equals `destination`. The
source's permission mode is preserved. Refuses to move through a symlink at either endpoint.

**Errors.** `not_found` (missing source), `not_a_file` (directory source, or directory destination),
`invalid_input` (destination exists without `overwrite`, same source/destination, or a symlink),
`path_escape`, `io_error`.

## copy

Copy one file (atomic publish via temp + `rename`, binary-safe). Files only — a directory source is
rejected; use `bash` for directory copies.

| Input         | Type    | Required | Default | Notes                                                     |
| ------------- | ------- | -------- | ------- | --------------------------------------------------------- |
| `source`      | string  | yes      | —       | File to copy.                                            |
| `destination` | string  | yes      | —       | Copy target. Missing parent directories are created.     |
| `overwrite`   | boolean | no       | `false` | When true, replace an existing destination file.          |

**Output.** A success message naming the source and destination. The source's permission mode is
preserved and its bytes are copied exactly (binary-safe). Same refusals as `move` (existing
destination, identical paths, symlink endpoints).

**Errors.** `not_found`, `not_a_file`, `invalid_input`, `path_escape`, `io_error`.

## mkdir

Create a directory, including any missing parents (like `mkdir -p`). Idempotent — succeeds if the
directory already exists.

| Input  | Type   | Required | Notes                                                    |
| ------ | ------ | -------- | -------------------------------------------------------- |
| `path` | string | yes      | Directory to create. Missing parent directories are made.|

**Output.** A message stating the directory was created (or already existed). Fails if the path
already exists as a file.

**Errors.** `not_a_file` (path, or a parent component, is a file), `path_escape`, `io_error`.

## remove

Delete one file. Files only — a directory is rejected; use `bash` for recursive directory removal.

| Input  | Type   | Required | Notes            |
| ------ | ------ | -------- | ---------------- |
| `path` | string | yes      | File to delete.  |

**Output.** A message naming the removed file. Fails with `not_found` if the path does not exist, and
refuses to delete through a symlink.

**Errors.** `not_found`, `not_a_file` (path is a directory), `invalid_input` (symlink), `path_escape`,
`io_error`.

## bash

Run a shell command via `sh -c` and return stdout, stderr, and exit code.

| Input        | Type    | Required | Default          | Notes                                                                                  |
| ------------ | ------- | -------- | ---------------- | -------------------------------------------------------------------------------------- |
| `command`    | string  | yes      | —                | The shell command.                                                                     |
| `cwd`        | string  | no       | workspace root   | Working directory.                                                                     |
| `timeout_ms` | integer | no       | `120000`         | Max run time; may be raised up to `bashTimeoutMaxMs` (`600000`). A larger value clamps.|

**Output.** On success, a JSON object `{ exit_code, stdout, stderr, signal, timed_out }`. The command
runs to completion and **blocks** until it exits (stdin is closed) — a long-lived process must be
backgrounded, e.g. `npm start > /tmp/out.log 2>&1 &`. **A non-zero exit is a normal result, not an
error** (`isError` is `false`). stdout/stderr are budgeted against a shared `maxOutputBytes`; overflow
is written to a `.clarvis/` spill file referenced in the result (see [Limits & spill](/guide/limits-and-spill)).

**Errors.** `timeout` (process group killed; partial output returned), `output_limit` (a hard
per-stream in-memory ceiling was hit and the command was killed), `not_found` / `not_a_file` (bad
`cwd`), `path_escape` (`cwd` outside the workspace), `io_error` (spawn failure).

## monitor_start

Standardized background-process monitors. `bash` blocks until a command exits; a **monitor** is its
complement for a command that doesn't — a dev server, `tail -f`, a watcher. No state is held
in-process: each call re-derives the truth from the `.clarvis/monitor-<id>.{json,log,exit}` sidecars
and the live OS process, so monitors are as stateless as the file tools.

`monitor_start` launches a command in the background and returns its id immediately, optionally
blocking until the output signals it is ready.

| Input              | Type    | Required | Default        | Notes                                                                                          |
| ------------------ | ------- | -------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `command`          | string  | yes      | —              | Shell command, run via `sh -c`. Do **not** append a trailing `&` — the monitor backgrounds it. |
| `cwd`              | string  | no       | workspace root | Working directory.                                                                             |
| `ready_when`       | string  | no       | —              | Regex; when set, the call blocks until the combined output matches it (see below).             |
| `ready_timeout_ms` | integer | no       | `30000`        | Max wait for `ready_when` (`monitorReadyTimeoutMs`). Ignored unless `ready_when` is set.        |

**Output.** Returns immediately with `{ id, running, ready, output, next_offset }`. The command's
combined stdout+stderr is appended to `.clarvis/monitor-<id>.log`. When `ready_when` is given the call
**blocks** until the log matches it — or until `ready_timeout_ms` elapses, or the process exits — and
`ready` reports whether the match was seen (`null` when no `ready_when` was given). `ready_when` is
tested against the first `maxOutputBytes` of output, so a marker printed only after that much startup
chatter is not detected. At most `maxMonitors` (default 32) live monitors may exist at once.

**Errors.** `too_many_monitors` (`maxMonitors` reached), `invalid_input` (bad `ready_when` regex),
`not_found` / `not_a_file` (bad `cwd`), `path_escape` (`cwd` outside the workspace), `io_error` (spawn
failure).

## monitor_poll

Read new output from a monitor since a byte offset.

| Input    | Type    | Required | Default | Notes                                                                  |
| -------- | ------- | -------- | ------- | ---------------------------------------------------------------------- |
| `id`     | string  | yes      | —       | The monitor id from `monitor_start`.                                   |
| `offset` | integer | no       | `0`     | Byte offset to read from; pass back the previous poll's `next_offset`. |
| `match`  | string  | no       | —       | Regex; keep only matching lines.                                       |

**Output.** `{ running, output, next_offset, exit_code }` — pass `next_offset` back to page forward.
`exit_code` is the command's **natural** exit code once it has exited on its own: `null` while
running, and `null` if the monitor was stopped or killed. Output is bounded to `maxOutputBytes`; while
the process is still running and `match` is not set, a partial trailing line is held back so a line is
not split across polls (with `match`, or when the byte cap truncates the slice, a line may span two
polls).

**Errors.** `monitor_not_found` (unknown `id`), `invalid_input` (bad `match` regex).

## monitor_stop

Stop a monitor and remove its files.

| Input | Type   | Required | Notes                                |
| ----- | ------ | -------- | ------------------------------------ |
| `id`  | string | yes      | The monitor id from `monitor_start`. |

**Output.** `{ stopped, id }`. Signals the monitor's whole process group (SIGTERM, then SIGKILL after
a short grace) and removes its sidecars. Idempotent for an already-exited monitor — it just cleans up.

**Errors.** `monitor_not_found` (unknown `id`).

## monitor_list

List every monitor, running and finished. Takes no arguments.

**Output.** `{ monitors: [ { id, command, running, started_at, cwd } ] }`, newest first. Use it to
find and stop leaked monitors.

**Errors.** None specific to this tool.

**Reaping & leaks.** A monitor's process **outlives the tool call** and survives host exit, so a
forgotten monitor leaks (the same exec exposure as `bash`, not a sandbox).
`sweepMonitors(workspaceRoot)` — the companion to `sweepSpillDir` — removes the sidecars of monitors
whose process has exited and leaves live ones untouched; call it at session start. `exit_code` is
captured for a **natural** exit only: a command that `exec`s away or is killed leaves `exit_code`
null. See [Limits & spill](/guide/limits-and-spill) and
[Core API → `sweepMonitors`](/reference/core-api#sweepmonitors).

## See also

- [Error codes](/reference/error-codes) — every `error` value and what it means
- [Text & encoding](/explanation/text-and-encoding) — UTF-16, binary detection, line endings, BOM
- [Limits & spill](/guide/limits-and-spill) — output/input bounds and `bash` spill files
- [`SPEC.md`](https://github.com/getclarvis/agent-tools/blob/main/SPEC.md) — the canonical contract
