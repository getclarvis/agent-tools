# The tools

> The nine tools, their inputs, outputs, and error codes. Four are read-only; five mutate. In
> [read-only mode](/guide/read-only-mode) only the read tools are registered. This mirrors the
> canonical [`SPEC.md`](https://github.com/getclarvis/agent-tools/blob/main/SPEC.md) in the repo.

| Tool                          | Mutating | Summary                                                            |
| ----------------------------- | -------- | ------------------------------------------------------------------ |
| [`read_file`](#read_file)     | no       | Read a text file (UTF-8/UTF-16), with line numbers, paging, tail.  |
| [`list_dir`](#list_dir)       | no       | List the entries of a directory.                                   |
| [`glob`](#glob)               | no       | Find files by glob, most-recently-modified first.                  |
| [`grep`](#grep)               | no       | Search file contents by regular expression (optionally multiline). |
| [`write_file`](#write_file)   | yes      | Create or overwrite a file (atomic).                               |
| [`edit_file`](#edit_file)     | yes      | Replace one exact occurrence of a string in a file.                |
| [`multi_edit`](#multi_edit)   | yes      | Apply several `edit_file`-style edits to one file atomically.      |
| [`apply_patch`](#apply_patch) | yes      | Apply a unified diff (modify/create/delete/rename) atomically.     |
| [`bash`](#bash)               | yes      | Run a shell command (`sh -c`) and capture stdout/stderr/exit.      |

Every failure is a JSON [error envelope](/reference/error-codes). Success is plain text for every
tool **except `bash`**, whose success result is a JSON object.

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

## See also

- [Error codes](/reference/error-codes) — every `error` value and what it means
- [Text & encoding](/explanation/text-and-encoding) — UTF-16, binary detection, line endings, BOM
- [Limits & spill](/guide/limits-and-spill) — output/input bounds and `bash` spill files
- [`SPEC.md`](https://github.com/getclarvis/agent-tools/blob/main/SPEC.md) — the canonical contract
