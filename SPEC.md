# @clarvis/agent-tools — Specification

This document specifies the behavior of each tool exposed by
`@clarvis/agent-tools`. For installation, configuration, and the
security model, see [README.md](./README.md).

## Conventions

- **Return value.** Each tool call returns `{ isError, text }`. On success
  `text` is the tool's output; on failure `isError` is set and `text` is a JSON
  error object (see [Errors](#errors)).
- **Result format.** On success every tool returns plain text **except `bash`**,
  whose success result is a JSON object (`exit_code`, `stdout`, `stderr`,
  `signal`, `timed_out`); a non-zero exit is a success (`isError` false), not an
  error. Only spawn/timeout/output-limit failures of `bash` flag `isError`. All
  failures, for every tool, are the JSON error object above.
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
  and `grep` skips the oversized file.
- **Text & encoding.** Text tools operate on UTF-8. A UTF-16 file with a BOM (LE/BE)
  is decoded by `read_file`, but the editing tools refuse it (`is_binary`) rather than
  rewrite it as UTF-8. Other binary files (NUL byte in the first/last 8 KB, no UTF-16
  BOM) are rejected by the text tools with `is_binary`.
- **Line endings & BOM.** On read, content is normalized to `\n` for matching.
  On write, the editing tools (`edit_file`, `multi_edit`, `apply_patch` modify)
  **preserve each untouched line's original terminator** (`\r\n`, `\n`, or lone
  `\r`); newly inserted or edited lines use the file's dominant terminator. A
  leading UTF-8 BOM is preserved.
- **Output bounding.** Every result is capped to `MAX_OUTPUT_BYTES` (default
  131072), truncated on a UTF-8 boundary with a trailing marker.
- **Atomicity.** All mutations write to a temp file and `rename` into place;
  multi-file operations (`apply_patch`) are staged and committed transactionally
  with rollback (a rename/move participates with both its source and destination). Writes to the same path are serialized by an in-process lock —
  this is the single-process contract; concurrent processes or external
  editors are **not** coordinated. A symlink target is refused (the link is not
  followed and not replaced).
- **BOM.** A leading U+FEFF is treated as a byte-order mark: stripped from the
  content returned by `read_file`/used for matching, and re-emitted on write.

## Read-only surface

In `--read-only` mode only `read_file`, `list_dir`, `glob`, and `grep` are
exposed; the mutating tools are not registered.

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

## write_file

Create or overwrite a file with the given content (atomic).

**Input:** `path` (string, required); `content` (string, required).

**Behavior:** Writes `content` exactly. Missing parent directories are created.

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

**Errors:** `timeout`, `output_limit`, `not_found`/`not_a_file` (bad `cwd`),
`path_escape` (`cwd` outside the workspace), `io_error` (spawn failure).

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
| `no_match`        | `edit_file`/`multi_edit` could not find `old_string`.     |
| `ambiguous_match` | `old_string` matched more than once without `replace_all`.|
| `patch_failed`    | A patch hunk did not apply cleanly.                       |
| `timeout`         | `bash` command exceeded its timeout.                      |
| `output_limit`    | `bash` output exceeded the hard capture ceiling.          |
| `too_large`       | Input file exceeded `MAX_FILE_BYTES`.                     |
| `path_escape`     | Path resolved outside the confined workspace root.        |
| `io_error`        | An underlying filesystem/process error.                   |
| `internal`        | Unexpected internal error.                                |
