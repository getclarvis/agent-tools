# Contributing to @clarvis/agent-tools

Thanks for your interest in contributing! This document covers how to get set up, the quality gate,
and the conventions this codebase follows. By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

```bash
git clone https://github.com/getclarvis/agent-tools.git
cd agent-tools
npm install
```

Requires **Node.js >= 20**. [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) on `PATH` is
optional — when present, `grep` uses it; otherwise an equivalent in-process backend runs, and the two
are kept behaviorally consistent.

## Development workflow

```bash
npm run build          # emit dist/ (tsc, with .d.ts)
npm test               # full vitest suite (contract + integration)
npm run typecheck      # tsc --noEmit (strict)
npm run lint           # eslint
npm run format         # prettier --write (src + tests)
```

Before opening a pull request, make sure the quality gate is green:

```bash
npm run pre-commit     # typecheck + format:check + test
```

CI runs `typecheck`, `lint`, `format:check`, `test`, and `build` on pushes and PRs targeting `main`
and `develop`, across a Node matrix (`20.x`, `lts/*`, `current`). There is no separate coverage gate.

## Project layout

- `src/index.ts` — the public API (`createAgentTools`, `dispatch`, `listTools`, `resolveConfig`,
  `buildConfig`, the registry, and the error contract).
- `src/core.ts` — the dispatch pipeline: validate (ajv) → run handler → bound output → serialize error.
- `src/config.ts` — config resolution, defaults, and the argv/env builder.
- `src/errors.ts` — `ToolError`, `serializeError`, `fsError`, and the `ErrorCode` union.
- `src/tools/` — the nine tool handlers plus the registry (`registry.ts`) and `ToolDef` type.
- `src/lib/` — the shared primitives: path confinement, text decode/encode, the edit match cascade,
  atomic writes, the two search backends, and output bounding/spill.
- `tests/` — `contract/` (one file per tool) and `integration/` (cross-cutting) suites, with
  `helpers/fixtures.ts`.

For the architecture and per-subsystem internals, see [`docs-internal/`](docs-internal/). User-facing
docs live in [`docs/`](docs/) and the canonical per-tool contract in [`SPEC.md`](SPEC.md).

## Guidelines

- **Match the surrounding style.** The codebase is strict TypeScript with `noUncheckedIndexedAccess`;
  prefer explicit, narrow types over `any`/casts. **No JSDoc or inline comments** unless a
  lint/quality rule requires them.
- **Add tests** for behavior changes. `tests/contract/` guards each tool's input/output/error
  contract; `tests/integration/` guards cross-cutting behavior (the public API, surface selection,
  statelessness). Changing a tool contract means updating its contract test, [`SPEC.md`](SPEC.md), and
  `docs/reference/tools.md` together.
- **Keep the two grep backends in agreement.** Any change to matching, context, or globbing must land
  in both the ripgrep and in-process paths and be covered by `tests/integration/grep-parity.test.ts`.
- **Security-sensitive changes** — anything touching path confinement, `bash` / subprocess spawning,
  atomic writes, or spill files — deserve extra scrutiny. See [SECURITY.md](SECURITY.md).
- **Update docs** when you change a tool contract, a config option, or an observable behavior:
  [`SPEC.md`](SPEC.md), the matching `docs/` reference page, and the matching
  [`docs-internal/internals/`](docs-internal/internals/) page.

## Reporting bugs and requesting features

Open a [GitHub issue](https://github.com/getclarvis/agent-tools/issues) using the provided templates.
For security issues, follow the private process in [SECURITY.md](SECURITY.md) instead.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
