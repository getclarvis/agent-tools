# Development commands

> Local commands for working on the `@clarvis/agent-tools` source. See
> [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contributor workflow and
> [testing.md](./testing.md) for the test suites.

```bash
npm install
npm run build        # emit dist/ (tsc -p tsconfig.build.json, with .d.ts)
npm test             # vitest run (contract + integration)
npm run typecheck    # tsc -p tsconfig.json --noEmit (strict)
npm run lint         # eslint src + tests
```

| Command | What it does |
|---|---|
| `npm run build` | Emit `dist/` via `tsc -p tsconfig.build.json` (declarations included). |
| `npm test` | Run the whole suite (`vitest run`) — `tests/contract/` + `tests/integration/`. |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` (strict, `noUncheckedIndexedAccess`). |
| `npm run lint` | ESLint over `src/**/*.ts` and `tests/**/*.ts`. |
| `npm run format` / `format:check` | Prettier write / check over `src` + `tests`. |
| `npm run test:coverage` | `vitest run --coverage` — the suite plus the 95% coverage gate (v8 provider). |
| `npm run pre-commit` | `typecheck && format:check && test:coverage` — the local quality gate. |
| `npm run prepublishOnly` | Guards publishing: asserts `README.md` + `SPEC.md` exist, then `build && test`. |

Run the gate before pushing:

```bash
npm run pre-commit   # typecheck && format:check && test
```

CI ([.github/workflows/ci.yml](https://github.com/getclarvis/agent-tools/blob/main/.github/workflows/ci.yml))
runs `typecheck`, `lint`, `format:check`, `test:coverage`, and `build` on pushes and PRs to `main` and
`develop`, across a Node matrix (`20.x`, `lts/*`, `current`; `20` is the supported floor per
`engines`). `test:coverage` enforces a 95% gate on lines, statements, functions, and branches.

## Docs

The published site is built from [`docs/`](../docs/) with VitePress:

```bash
npm run docs:dev      # local preview with HMR
npm run docs:build    # production build (fails on dead internal links)
npm run docs:preview  # serve the built site
```

`docs-internal/` (this directory) is **not** part of the VitePress site — it lives outside `docs/`,
so `docs:build` never processes or link-checks it, and it is never deployed to
[agent-tools.clarvis.dev](https://agent-tools.clarvis.dev).

## See also

- [CONTRIBUTING.md](../CONTRIBUTING.md) · [testing.md](./testing.md) · [releasing.md](./releasing.md)
