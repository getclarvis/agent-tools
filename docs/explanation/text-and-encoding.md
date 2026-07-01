# Text & encoding

> How the file tools treat bytes: which encodings they accept, how binary is detected, and how line
> endings and byte-order marks survive an edit. The guiding principle is *don't silently rewrite a
> file's bytes*.

## UTF-8, and UTF-16 on read only

The text tools operate on **UTF-8**. A **UTF-16** file with a byte-order mark (LE or BE) is detected
and decoded by `read_file`, so you can inspect it — but the editing tools (`edit_file`, `multi_edit`,
`apply_patch`) **refuse** it with `is_binary` rather than rewrite it as UTF-8. Reading is lossless;
silently changing a file's encoding on write is not, so the tools won't.

## Binary detection

A file is treated as binary — and rejected by the text tools with `is_binary` — when it has a **NUL
byte in the first or last 8 KB** and no UTF-16 BOM. This catches images, executables, and other
non-text content before a tool tries to line-number or edit it.

## Line endings

- **On read**, content is normalized to `\n` for matching and display, so `old_string` in an
  `edit_file` call matches regardless of the file's terminators.
- **On write**, each **untouched** line keeps its **original terminator** — `\r\n`, `\n`, or a lone
  `\r`. Newly inserted or edited lines use the file's **dominant** terminator (computed on read). A
  CRLF file stays CRLF; you don't get a mixed-ending file from a single edit.
- **Created** files (a `write_file` to a new path, or an `apply_patch` create) use `\n`.

## Byte-order mark

A leading UTF-8 BOM (U+FEFF) is treated as a byte-order mark: stripped from the content
`read_file` returns and from the text used for matching, and **re-emitted on write**. So editing a
BOM-prefixed file preserves its BOM.

## Atomicity

Every mutation writes to a temp file and `rename`s it into place, so a reader never sees a
half-written file. Multi-file operations (`apply_patch`) stage all their changes and commit or roll
back together — a rename participates with both its source and destination. A symlink target is
**refused**: the link is neither followed nor replaced. Writes to the same path are serialized by an
in-process lock (the single-process contract — external editors are not coordinated).

## Why it matters

Together these rules mean an agent can edit one line of a CRLF, BOM-prefixed file and get back a file
that differs **only** in that line — same encoding, same terminators, same BOM. Preserving bytes an
edit didn't touch keeps diffs clean and avoids spurious churn in version control.

## See also

- [The tools](/reference/tools) — which tools read vs. edit, and their error codes
- [Limits & spill](/guide/limits-and-spill) — the size limits that bound reads and edits
- [Error codes](/reference/error-codes) — `is_binary`, `too_large`
