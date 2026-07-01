# Internals: output bounding & spill

Source-level reference for how every result is capped and how `bash` overflow is spilled to disk. The
user-facing behavior is at [limits and spill](https://agent-tools.clarvis.dev/guide/limits-and-spill);
this page covers the truncation mechanics, the two-stream budget split, and the spill/sweep lifecycle
the published page omits.

## Source files

| Path | Responsibility |
|---|---|
| [`src/lib/output.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/output.ts) | `bound`, `boundOrSpill`, `allocateBudget`, `sweepSpillDir`, and the internal `truncate` / `cutPoint` / `truncationMarker`. |
| [`src/lib/token.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/token.ts) | `uniqueToken()` — the `<pid>-<ms>-<counter>-<rand>` id used in spill/temp names. |
| [`src/tools/bash.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/tools/bash.ts) | The only spill producer: per-stream capture ceiling, `allocateBudget`, `boundOrSpill`. |

## Truncation: `bound(text, maxBytes)`

Every non-`bounded` tool's output passes through `bound` in `dispatch`. It is **UTF-8-safe**:
`truncate` measures `Buffer.byteLength`, and if over `maxBytes`, `cutPoint` walks the cut index back
off any UTF-8 continuation byte (`(b & 0xC0) === 0x80`) so a multibyte character is never split. It
appends a marker:

```text
[... output truncated: <end> of <total> bytes shown ...]
```

Under the cap, `bound` returns the text unchanged (no marker, no allocation of a new string beyond the
byte measurement).

## Two-stream budget: `allocateBudget(aBytes, bBytes, total)`

`bash` has two streams (stdout, stderr) sharing one `maxOutputBytes`. `allocateBudget` splits fairly:

- Both fit → give each its full size.
- Otherwise each stream is guaranteed at least `floor(total/2)`; if one stream is small it gets its
  full size and the other gets the remainder; if both are large they split down the middle.

The result is the `(outBudget, errBudget)` pair fed to two `boundOrSpill` calls.

## Spill: `boundOrSpill(text, maxBytes, spill)`

When a stream overflows its budget, instead of just truncating, `bash` writes the **full** stream to
a file and points at it:

1. `truncate` — under budget → return as-is.
2. `mkdir -p` the spill dir, best-effort drop a `.gitignore` containing `*` (`wx` flag; ignored if it
   exists) so the spill dir is never committed.
3. Write the full text to `spill.absPath` (`bash-<token>.<stream>.log` under `<workspaceRoot>/.clarvis`).
4. Return the truncated head plus a marker naming the file:
   `[... output truncated: <end> of <total> bytes shown; full output written to <displayPath> ...]`.
5. If the write fails, fall back to the plain truncation marker (never throw for a spill failure).

`bash` is `bounded: true`, so it opts out of `dispatch`'s outer `bound()` and owns this whole path.

## The bash capture ceiling (a different limit)

Distinct from the display budget: while a command runs, each stream sink has a **capture ceiling** of
`max(maxOutputBytes, 8 MiB)` (`MAX_CAPTURE_FLOOR`). The first stream to exceed it sets `outputLimited`
and **kills the process group** (`SIGKILL` on `-pid`), and the call rejects with `output_limit`. This
is the memory guard — it stops an unbounded producer (`yes`, a runaway log) from exhausting the heap,
*before* the display-time `boundOrSpill` ever runs. Timeout works the same way (kills the group, then
`timeout`).

## Spill lifecycle: `sweepSpillDir(workspaceRoot)`

Spill files are not cleaned on read — they persist so the caller can inspect them. `sweepSpillDir`
(exported from the package root) is the opt-in janitor: it scans `<workspaceRoot>/.clarvis`, and
removes `bash-*` files older than `SPILL_MAX_AGE_MS` (24 h). A long-running host is expected to call
it periodically. It never throws (missing dir / stat failure → no-op).

## Maintainer notes

- **Truncation is measured in bytes, cut on a char boundary.** Don't reintroduce `string.length`
  slicing — it corrupts multibyte output and miscounts the cap.
- **Only `bash` spills**, because only `bash` has genuinely unbounded output. If another tool ever
  needs spill, reuse `boundOrSpill` + a `spillTarget` and set `bounded: true`.
- **Keep the capture ceiling ≥ the display cap.** The floor exists so short caps don't kill commands
  that merely produce a few MB; capture bounds memory, display bounds what the model sees.
- **`.clarvis/` is reserved and gitignored** (both by the auto-dropped `.gitignore` and by
  `lib/ignore.ts`). Spill names come from `uniqueToken()`; don't collide with `.clarvis-tmp-*` (the
  atomic-write backups — see [internals/atomic-writes.md](./atomic-writes.md)).
