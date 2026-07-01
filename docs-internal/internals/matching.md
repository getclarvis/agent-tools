# Internals: edit match cascade

Source-level reference for how `edit_file` / `multi_edit` locate the text to replace. There is no
user-facing page for the cascade beyond the `edit_file` contract in
[`SPEC.md`](../../SPEC.md) / the [tools reference](https://agent-tools.clarvis.dev/reference/tools);
this is the internal spec.

## Source file

[`src/lib/match-cascade.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/match-cascade.ts)
— exports `findCascadeMatch`, `scanLineBlocks`, `trimEnds`, and the `Span` type.

## The problem

An agent supplies `old_string` to locate an edit site, but its whitespace/indentation rarely matches
the file byte-for-byte. A naive `indexOf` fails too often; a too-loose match edits the wrong place.
The cascade resolves this with **progressively looser tiers**, taking the strictest tier that yields
at least one non-disproportionate match — and refusing (`no_match` / `ambiguous_match` at the tool
layer) when a tier is ambiguous.

## `findCascadeMatch(text, oldString) → { spans } | null`

1. LF-normalize `oldString`; empty → `null`.
2. Precompute `lineStarts(text)` (byte offsets of each line) and `oldLineCount` (old block minus
   trailing blank lines).
3. Run the tiers in order; for each, drop **disproportionate** spans, then dedupe. The **first** tier
   with ≥ 1 surviving span wins and returns those spans.

The tiers (strictest → loosest):

| Tier | Function | Matches when… |
|---|---|---|
| 1. Indentation-flexible | `indentationFlexible` | the block matches after **dedent** (common leading indent stripped from both sides). |
| 2. Line-trimmed | `lineTrimmed` | each line matches after `trim()` of both sides. |
| 3. Whitespace-normalized | `whitespaceNormalized` | each line matches after collapsing all runs of whitespace to a single space (`norm`). |
| 4. Trimmed-boundary | `trimmedBoundary` | the `old.trim()` string is found as a raw substring (can land **mid-line**). |

Tiers 1–3 are **whole-line** block matchers built on `scanLineBlocks(hay, need, eq)`. Tier 4 is a
substring matcher and runs **last on purpose**: it can match a fragment inside a line, and if it ran
before the line tiers an indented full-line edit would keep the file's indent *and* gain
`new_string`'s indent, doubling it. Each tier is a superset of the previous, so the strictest tier
that produces a unique match is the most precise interpretation of the agent's intent.

## Span computation & the trailing-newline rule

`blockSpan(starts, textLen, i, m, oldEndsNL)` turns a match at line `i` spanning `m` lines into a
byte `{ start, end }`. If `old` ended in a newline **and** there's a following line, `end` is extended
to the start of the next line so the replacement consumes the block's trailing newline too — this is
what keeps line counts stable across an edit.

## Disproportionate-match rejection

`disproportionate(span, text, oldLen, oldLineCount)` guards against a loose tier swallowing far more
than intended: a span is rejected if it covers **≥ 2×** the old line count, or if it is **≥ 500 bytes
longer** than `old`. This prevents, e.g., a whitespace-normalized match from spanning a huge region
that merely shares normalized whitespace.

## How the tools consume it

`edit_file` calls `findCascadeMatch`; the result drives the tool-level decision:

- `null` → `no_match`.
- `spans.length > 1` → `ambiguous_match` (the agent must disambiguate with more context).
- exactly one span → splice `new_string` in, `reencode` (preserving endings), `writeAtomic`.

`multi_edit` applies a sequence of such edits to one file under a single lock, atomically — each edit
re-matches against the evolving buffer.

## Maintainer notes

- **Order is the contract.** Line tiers before the substring tier; strict before loose. Reordering
  changes which edits are considered ambiguous.
- **Tune the disproportion limits together with tests.** The `2×` / `500-byte` thresholds are the
  safety valve; changing them shifts the ambiguous/no-match boundary. Cover changes in
  `tests/contract/edit-file.test.ts` and `multi-edit.test.ts`.
- **Everything is LF-normalized before matching**; ending preservation is `reencode`'s job, not the
  cascade's. See [internals/text-and-encoding.md](./text-and-encoding.md).
