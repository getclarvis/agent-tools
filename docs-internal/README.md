# Contributor docs (`docs-internal/`)

> Repo-only documentation for people editing the `@clarvis/agent-tools` **source**. It is **not**
> built into the published site ([agent-tools.clarvis.dev](https://agent-tools.clarvis.dev)) and
> **not** shipped to npm (`docs-internal/` is outside the `package.json` `files` whitelist).
> User-facing docs live in [`docs/`](../docs/).

The published site is for *users* — people embedding these tools in an agent loop or transport.
Everything here is for *maintainers*: source-file maps, internal function names, the dispatch
pipeline, the atomic-write and match-cascade mechanics, and the build/release machinery — the
material that is deliberately kept out of the user docs.

## Map

| Page | Covers |
|---|---|
| [architecture.md](./architecture.md) | The dispatch pipeline (`validate → handle → bound → serialize`), read-only surface selection, and the `config` / `tools` / `lib` layering — with `src/` links. |
| [source-map.md](./source-map.md) | Index of the per-subsystem internals pages and the key `src/` entry points. |
| [dev-commands.md](./dev-commands.md) | Local development commands (build, test, typecheck, lint, format, docs). |
| [testing.md](./testing.md) | The `contract/` and `integration/` suites and the `fixtures.ts` helper. |
| [releasing.md](./releasing.md) | The pre-publish checklist for shipping to GitHub and npm. |
| [internals/](./internals/) | One page per subsystem: `src/` files, functions, constants, and mechanics that were stripped from the user reference. |

## The user/contributor split

User docs and contributor docs are two separate sources by design:

- **User docs** (`docs/`, published, plus the canonical [`SPEC.md`](../SPEC.md)) describe *behavior and
  contracts* — what each tool accepts, what each error code means, how output bounding works — with no
  `src/` paths or internal symbol names.
- **Contributor docs** (`docs-internal/`, repo-only) describe *how it's implemented* — the files,
  functions, and constants behind that behavior.

When a tool's contract changes, update `SPEC.md` and the user reference in `docs/`; when the
implementation behind it changes, update the matching [`docs-internal/internals/`](./internals/) page.

## See also

- [User documentation](https://agent-tools.clarvis.dev) · [`docs/` source](../docs/) · [`SPEC.md`](../SPEC.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md) · [SECURITY.md](../SECURITY.md)
