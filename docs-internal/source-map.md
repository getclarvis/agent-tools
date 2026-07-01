# Source map

> Where each user-facing behavior is implemented, and the per-subsystem internals pages. Use this to
> jump from a documented behavior to the code behind it.

## Per-subsystem internals

Each page below catalogs the `src/` files, internal functions, and constants behind one area (the
detail that was stripped from `SPEC.md` and the published reference):

| Subsystem | Internals page | User-facing counterpart |
|---|---|---|
| Dispatch pipeline & result shape | [internals/dispatch.md](./internals/dispatch.md) | [/explanation/how-it-works](https://agent-tools.clarvis.dev/explanation/how-it-works), [/reference/core-api](https://agent-tools.clarvis.dev/reference/core-api) |
| Config resolution & defaults | [internals/config.md](./internals/config.md) | [/reference/configuration](https://agent-tools.clarvis.dev/reference/configuration), [/reference/create-agent-tools](https://agent-tools.clarvis.dev/reference/create-agent-tools) |
| The tool registry & handlers | [internals/tools.md](./internals/tools.md) | [/reference/tools](https://agent-tools.clarvis.dev/reference/tools) |
| Path confinement | [internals/paths-and-confinement.md](./internals/paths-and-confinement.md) | [/explanation/confinement](https://agent-tools.clarvis.dev/explanation/confinement) |
| Text, encoding & EOL | [internals/text-and-encoding.md](./internals/text-and-encoding.md) | [/explanation/text-and-encoding](https://agent-tools.clarvis.dev/explanation/text-and-encoding) |
| Edit match cascade | [internals/matching.md](./internals/matching.md) | [/reference/tools](https://agent-tools.clarvis.dev/reference/tools) (`edit_file` / `multi_edit`) |
| Atomic writes & rollback | [internals/atomic-writes.md](./internals/atomic-writes.md) | [/reference/tools](https://agent-tools.clarvis.dev/reference/tools) (`write_file` / `apply_patch`) |
| Search (grep / glob / list) | [internals/search.md](./internals/search.md) | [/reference/tools](https://agent-tools.clarvis.dev/reference/tools) (`grep` / `glob` / `list_dir`) |
| Output bounding & spill | [internals/output-and-spill.md](./internals/output-and-spill.md) | [/guide/limits-and-spill](https://agent-tools.clarvis.dev/guide/limits-and-spill) |
| Error codes & envelope | [internals/errors.md](./internals/errors.md) | [/reference/error-codes](https://agent-tools.clarvis.dev/reference/error-codes) |

## Key entry points

| Area | Source |
|---|---|
| Public API surface | `src/index.ts` |
| Dispatch & tool listing | `src/core.ts` |
| Config / defaults / argv+env builder | `src/config.ts` |
| Error contract | `src/errors.ts` |
| Tool registry & surface selection | `src/tools/registry.ts`, `src/tools/types.ts` |
| Tool handlers | `src/tools/{read-file,list-dir,glob,grep,write-file,edit-file,multi-edit,apply-patch,bash}.ts` |
| Path confinement | `src/lib/paths.ts` |
| Text decode/encode | `src/lib/text.ts`, `src/lib/textfile.ts`, `src/lib/binary.ts` |
| Edit matching | `src/lib/match-cascade.ts` |
| Atomic writes / locks | `src/lib/atomic.ts` |
| Search backends | `src/lib/rg.ts`, `src/lib/files.ts`, `src/lib/ignore.ts` |
| Output bounding / spill | `src/lib/output.ts`, `src/lib/token.ts` |

See [architecture.md](./architecture.md) for how these fit together.
