# Internals: atomic writes, rollback & locks

Source-level reference for how every mutating tool writes to disk. There is no dedicated user-facing
page; the guarantees ("atomic", "never leaves a half-written file") are stated per-tool in
[`SPEC.md`](../../SPEC.md). This is the internal spec behind `write_file`, `edit_file`, `multi_edit`,
and `apply_patch`.

## Source file

[`src/lib/atomic.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/atomic.ts) — exports
`writeAtomic`, `applyOpsAtomic`, `withFileLock`, `withFileLocks`, and the `FileOp` type. Temp names
come from [`lib/token.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/token.ts)'s
`uniqueToken()`.

## Single-file write: `writeAtomic(target, content)`

The temp-then-rename dance, so a reader never sees a partial file and a crash never truncates the
target:

1. `assertNotSymlink(target)` — refuse to write **through** a symlink (`invalid_input`). Always on,
   independent of `confineToWorkspace`.
2. `stage(target, content)` — `mkdir -p` the dir, open a `.clarvis-tmp-<token>` sibling with the `wx`
   flag (exclusive create), write, **`fh.sync()`** (fsync the data), close.
3. Capture the target's current mode (`captureMode`) and `chmod` the temp to match, so an overwrite
   preserves permissions.
4. `fs.rename(tmp, target)` — atomic on the same filesystem. On any error, `rm` the temp and rethrow.
5. `fsyncDir(dirname(target))` — fsync the directory so the rename itself is durable.

## Per-path serialization: `withFileLock` / `withFileLocks`

Concurrency safety for the same path lives here, not in `dispatch`. A module-level
`Map<string, Promise>` chains operations on a given absolute path:

- `withFileLock(absPath, fn)` — runs `fn` after the previous operation on `absPath` settles (success
  **or** failure — `prev.then(fn, fn)`), and cleans the map entry when its own tail settles. Returns
  `fn`'s result/rejection to the caller while the map tracks the swallowed tail.
- `withFileLocks(paths, fn)` — acquires locks on a **sorted, de-duplicated** set of paths (nesting
  `withFileLock` right-to-left) before running `fn`. Sorting is the deadlock-avoidance rule: all
  multi-path operations acquire in the same global order.

`multi_edit` runs its whole edit sequence inside one `withFileLock` on the file; `apply_patch` wraps
`applyOpsAtomic` in `withFileLocks` over every path it touches.

## Multi-file transaction: `applyOpsAtomic(ops)`

`apply_patch` turns a unified diff into `FileOp[]` (`type: "create" | "modify" | "delete" |
"rename"`, `path`, optional `from`/`content`) and hands them here for an all-or-nothing apply:

1. **`stageAll`** — stage temp files for every create/modify (and for a rename that also rewrites
   content); a mkdir for a pure rename target. Any failure cleans all staged temps and throws.
2. **`validateTargets`** — per op: `assertNotSymlink`; a rename requires an existing non-dir source
   (`not_found` / `not_a_file`) and a **non-existing** destination (`invalid_input` if it exists);
   modify/delete/create record the existing mode (or `undefined`). This is the pre-flight that lets
   the commit assume validity.
3. **`commitWithRollback`** — apply ops in order, recording enough to undo each: the displaced
   original is renamed to a `.clarvis-tmp-<token>` **backup** before the staged temp is renamed into
   place (mode restored first). A rename backs up both sides. On **any** error mid-commit it walks the
   committed records **in reverse**, restoring backups / undoing renames.
4. **Durability** — fsync every touched directory (`dirs` set, including rename sources).
5. **Cleanup** — remove all backups once the commit fully succeeds.

### The unrestorable case

If rollback itself fails to restore a path, the original content is **not lost** — it's still in the
adjacent `.clarvis-tmp-*` backup. The thrown `io_error` names each such path
("original content preserved in an adjacent .clarvis-tmp-* backup" / "preserved at <path>") so a human
can recover manually. This is the one path where temp files intentionally survive.

## Maintainer notes

- **Never write a target directly.** Route every mutation through `writeAtomic` / `applyOpsAtomic` so
  the temp+fsync+rename and mode-preservation invariants hold.
- **Multi-path ops must go through `withFileLocks`** (sorted acquisition) — hand-rolling per-path locks
  risks deadlock.
- **`.clarvis-tmp-*` is reserved.** It's gitignored by `lib/ignore.ts` and skipped by tools; don't
  repurpose the prefix. Ordinary temps are cleaned on success; only the unrestorable-rollback backups
  are meant to linger.
- **`fh.sync()` and `fsyncDir` are the durability contract.** Dropping them would make writes
  atomic-on-rename but not crash-durable.
