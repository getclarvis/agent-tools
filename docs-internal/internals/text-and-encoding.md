# Internals: text, encoding & EOL

Source-level reference for how the file tools decode, preserve, and re-encode text. The user-facing
summary lives at [text and encoding](https://agent-tools.clarvis.dev/explanation/text-and-encoding);
this page covers the decode/re-encode mechanics and the binary heuristic the published page omits.

## Source files

| Path | Responsibility |
|---|---|
| [`src/lib/text.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/text.ts) | `decodeText`, `encodeText`, `reencode`, `splitLines`, `countNewlines`, and the line tokenizer. |
| [`src/lib/textfile.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/textfile.ts) | `readTextFile` (strict, for the read/edit tools) and `readTextBuffer` (lenient, for in-process grep). |
| [`src/lib/binary.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/binary.ts) | `isBinary` (NUL scan) and `isUtf16Bom`. |

## Decoding: `decodeText(buf) → DecodedText`

`DecodedText` is `{ content, eol, bom, raw, encoding }`. Detection order:

1. **UTF-16 LE** — BOM `FF FE` → decode `buf.subarray(2)` as `utf16le`.
2. **UTF-16 BE** — BOM `FE FF` → copy the body, `swap16()` to LE, decode. An odd trailing byte is
   dropped (`even = length - length % 2`).
3. **UTF-8** (default) — decode; if the first code unit is `U+FEFF`, strip it and set `bom = true`.

`encoding` is one of `"utf8" | "utf16le" | "utf16be"`; `bom` records whether a BOM was present.

**EOL detection** counts `\n` occurrences, classifying each as `crlf` (preceded by `\r`) or bare
`lf`; `eol = crlf > lf ? "crlf" : "lf"`. **`content`** is always LF-normalized (`\r\n`→`\n`, lone
`\r`→`\n`) so downstream matching/paging works on one line convention. **`raw`** keeps the original
(post-BOM-strip, pre-LF-normalize) string so `reencode` can recover the exact per-line endings.

## Reading: strict vs lenient

- **`readTextFile(target, relForError, maxBytes)`** — used by `read_file` and the edit tools. `stat`
  (fs errors mapped via `fsError`), reject a directory (`not_a_file`), reject over `maxBytes`
  (`too_large`, with `{ size, limit }`), read, then `rejectIfUnreadable`: a real UTF-16-BOM file is
  allowed (it legitimately contains NUL bytes), any other NUL-bearing file is rejected as
  `is_binary`. Returns `DecodedText`.
- **`readTextBuffer(target, maxBytes)`** — used by the in-process grep backend. Same idea but
  **lenient**: any failure (missing, too large, unreadable, binary) returns `null` so grep silently
  skips the file instead of erroring the whole search.

## The binary heuristic: `isBinary(buf)`

A NUL byte (`0x00`) is treated as the binary signal. To stay fast on large files, `isBinary` scans
the first `SCAN_BYTES` (8000) bytes and, if the file is larger, the last `SCAN_BYTES` too — a NUL in
either window → binary. `isUtf16Bom` is the escape hatch: UTF-16 text is full of NULs, so a leading
UTF-16 BOM overrides the binary verdict in `readTextFile`.

## Re-encoding: `reencode(newContent, decoded)`

The edit tools work on LF-normalized `content` but must write back a file that preserves the
original's encoding, BOM, and **per-line** endings. `reencode`:

1. Tokenizes `decoded.raw` and `newContent` into `{ text, end }` lines (`end` is the exact terminator
   `\r\n` / `\r` / `\n` / `""`).
2. Diffs the two line-text sequences with `diffArrays` (from the `diff` package) and, for every
   **unchanged** line, maps the new line's ending back to the corresponding old line's ending.
3. For **added** lines (no original counterpart) it uses `dominantEnd(oldLines)` — the most common
   terminator in the original file.
4. Re-attaches the BOM if `decoded.bom`.

`encodeText(content, { eol, bom })` is the simpler whole-file form (used when a file is written wholesale
rather than line-diffed): LF-normalize, apply `crlf` if requested, prepend BOM if requested.

> UTF-16 re-encoding: the current writers emit UTF-8 bytes via `writeAtomic(..., "utf8")`. When
> touching this area, verify the round-trip you intend — `decodeText` distinguishes the three
> encodings, but the write path is where the output encoding is actually chosen.

## Maintainer notes

- **Keep `content` LF-only.** Every matcher, pager, and line counter assumes it. Encoding/EOL concerns
  belong at the decode and re-encode edges, never in the middle.
- **Preserve endings through edits.** If you add an edit-style tool, re-encode via `reencode` (not a
  naive `join("\n")`) or you'll rewrite every line ending in the file.
- **The binary rule is NUL-only and windowed.** A file with NULs only in the middle of a >16 KB body
  can slip past; that's an accepted trade-off for speed. UTF-16 BOM files must stay exempt.
