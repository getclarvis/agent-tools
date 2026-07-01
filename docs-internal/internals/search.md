# Internals: search (grep / glob / list)

Source-level reference for the two grep backends and the file-listing/gitignore primitives shared by
`grep`, `glob`, and `list_dir`. The user-facing contracts are in [`SPEC.md`](../../SPEC.md) and the
[tools reference](https://agent-tools.clarvis.dev/reference/tools); this page covers the backend
parity rules and gitignore semantics the published pages omit.

## Source files

| Path | Responsibility |
|---|---|
| [`src/lib/rg.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/rg.ts) | `grepSearch` → `ripgrepSearch` (subprocess) or `inProcessSearch` (RegExp), plus multiline emission. |
| [`src/lib/files.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/files.ts) | `listFiles` (`tinyglobby` + gitignore filter), `statDirectory`, `mapLimit`, `STAT_CONCURRENCY`. |
| [`src/lib/ignore.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/ignore.ts) | `loadIgnore` — hierarchical `.gitignore` / exclude matcher. |

## Two backends, one contract: `grepSearch(params, config)`

`grepSearch` stats the search root, and for a **single file** short-circuits to an empty result if it
is over `maxFileBytes` or binary. Then it dispatches on `config.ripgrepAvailable`:

- **`ripgrepSearch`** — spawns `rg` with `--no-config --json --hidden -g '!.git' --max-filesize
  <maxFileBytes>`, plus `-i` / `--multiline --multiline-dotall` / `-B` / `-A` as requested. For a
  directory it runs with `cwd = searchRoot` and search arg `.` (and passes the caller `glob` via
  `-g`); for a single file, `cwd = dirname` and arg `basename`. It parses the JSON event stream into
  `Match { file, lineNumber, text, kind }`. A **stream cap** of `maxOutputBytes * RG_JSON_OVERHEAD`
  (×8, to account for JSON framing) kills `rg` with `SIGKILL` and sets `truncated`. Exit code `2`
  with no matches and no truncation → `invalid_input` (a real ripgrep error, e.g. bad regex).
- **`inProcessSearch`** — the fallback when `rg` isn't on `PATH`. Builds a `RegExp` (flags:
  `gms`/`gmsi` for multiline, `i`/`""` otherwise; an invalid pattern → `invalid_input`), gathers
  files via `gatherFiles` (→ `listFiles`, gitignore-respecting), reads each with `readTextBuffer`
  (skips missing/oversized/binary), and emits matches with `-B`/`-A` context. It tracks a byte
  `budget` (`maxOutputBytes`) and stops with `truncated` once exceeded.

Both return `GrepResult { matches, truncated }` with the **same** match/context shape and line
numbers. Keeping them in agreement is the whole point of
[`tests/integration/grep-parity.test.ts`](https://github.com/getclarvis/agent-tools/blob/main/tests/integration/grep-parity.test.ts),
which runs the same queries through both backends and diffs the results.

### Multiline emission

`emitMultiline` (in-process) reconstructs line numbers from match byte offsets via a binary search
over newline positions, groups matched lines into runs, marks multi-line runs so the whole run is
emitted from its anchor line, then adds `-B`/`-A` context around run boundaries. This mirrors what
`rg --multiline --multiline-dotall` produces so parity holds for multiline patterns too.

## Listing & glob: `listFiles(base, workspaceRoot, opts)`

`glob` and the in-process grep both list through `listFiles`:

- Globs with `tinyglobby` (`glob(pattern, { cwd: base, dot: true, onlyFiles: true, absolute: false })`)
  — hidden files included, files only.
- If `respectGitignore`, filters each result through `loadIgnore(workspaceRoot).ignores(rel)`.
- Returns absolute paths. `grep`'s `gatherFiles` normalizes a bare `glob` (no `/`) to `**/<glob>` and
  sorts the kept files for deterministic order.

`statDirectory` centralizes the "must be a directory" check (used by `list_dir` and `bash`'s cwd
validation). `mapLimit` + `STAT_CONCURRENCY` (32) bound parallel `stat`s when listing entries.

## Gitignore semantics: `loadIgnore(workspaceRoot)`

A hierarchical matcher that mimics git's precedence:

- **Ignore root** = the nearest ancestor containing `.git` (else the workspace root).
- **Base rules** always include `.git`, `.clarvis`, `.clarvis-tmp-*`, plus `.git/info/exclude` and the
  user's global excludes (`XDG_CONFIG_HOME/git/ignore` or `~/.config/git/ignore`).
- **Per-directory `.gitignore`** files are read and cached (`perDir` map) along the chain from the
  ignore root down to the file's directory; each dir's rules are applied against the path **relative
  to that dir**, later (deeper) rules overriding earlier ones, with negation (`!`) honored via the
  `ignored`/`unignored` result. Anything under a `.git` directory is always ignored.

This is why the tools never surface `.git/`, the `.clarvis/` spill dir, or in-flight `.clarvis-tmp-*`
backups, and why they honor the same ignores git would.

## Maintainer notes

- **Parity is the invariant.** Any change to matching, context, globbing, or truncation must land in
  **both** `ripgrepSearch` and `inProcessSearch` (or in shared code they both call), with
  `grep-parity.test.ts` extended to prove it. A behavior that only one backend has is a bug.
- **`--no-config` is deliberate** — never let a user's `RIPGREP_CONFIG_PATH` change results; the two
  backends must not diverge based on ambient config.
- **The stream cap is ×8 the output cap** because `rg --json` is verbose; it bounds memory, not the
  final result (which `dispatch`/`bound` caps). Don't conflate the two.
- **Reserved paths stay ignored.** Keep `.git` / `.clarvis` / `.clarvis-tmp-*` in the base ignore set.
