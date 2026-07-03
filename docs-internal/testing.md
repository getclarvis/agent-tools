# How to run and extend the test suites

> `npm test` runs the whole suite offline and deterministically with `vitest run` — the `contract/`
> per-tool tests plus the `integration/` end-to-end tests. No network, no mocks, no credentials:
> every test drives the real `dispatch` against a temp-directory workspace.

This guide explains the two test directories that ship with `@clarvis/agent-tools`, how they run, and
the shared fixtures that make each test hermetic. It maps the npm scripts to the underlying
[Vitest](https://vitest.dev) config so you know exactly what each command exercises.

## Test suites at a glance

| Suite | Directory | In `npm test`? | What it covers |
|---|---|---|---|
| Contract | `tests/contract/` | Yes | One file per source module — each of the nine tools, plus `config`, `errors`, the cross-tool `symlink` policy, and every `src/lib/` primitive (`atomic`, `binary`, `ignore`, `match-cascade`, `output`, `paths`, `rg`, `text`, `textfile`, `log`): the input/output/error contract of that module, driven through `dispatch` where it has a tool surface and called directly where it is a primitive. |
| Integration | `tests/integration/` | Yes | Cross-cutting behavior: the public API (`api.test.ts`), core dispatch and the registry (`core.test.ts`), grep backend parity (`grep-parity.test.ts`), read-only surface (`read-only.test.ts`), confinement off (`no-isolation.test.ts`), and statelessness (`statelessness.test.ts`). |

The Vitest config ([vitest.config.ts](https://github.com/getclarvis/agent-tools/blob/main/vitest.config.ts))
uses the `node` environment, includes `tests/**/*.test.ts`, and excludes `tests/live/**` (reserved
for a future opt-in live suite — none ships today). `npm test` is `vitest run`, so a single pass
discovers and runs both directories.

```bash
npm test                          # everything
npx vitest run tests/contract     # one directory
npx vitest run grep-parity        # one file by name filter
npx vitest                        # watch mode
```

`npm run test:coverage` (`vitest run --coverage`, v8 provider) enforces a **95% gate** on lines,
statements, functions, and branches; CI and the local pre-commit gate
(`typecheck && format:check && test:coverage`) both run it, so a drop below any threshold fails the
build. There is **no live/model suite** in this package.

## Every test tells a real story

The 95% gate is a floor, not a target to game. The rule this suite holds to:

- **A test names a behavior, not a line.** Its title reads as a sentence the module guarantees —
  `"kills ripgrep once output exceeds the stream cap"`, not `"covers rg.ts 101-102"`. Line numbers,
  byte ranges, and branch identifiers never appear in a `describe` or `it` title.
- **Coverage is a by-product of documenting behavior.** To lift a number, extend the module's story
  file with a scenario a reader would want to see proven. Never add a file or test whose only purpose
  is to touch a line — there are **no `*-coverage.test.ts` files**, and there should never be.
- **An unreachable branch is a code smell, not a test gap.** If no honest scenario exercises a branch,
  the fix is usually to delete the dead branch, not to write a synthetic test that contorts inputs to
  reach it.
- **One story file per module.** Every case for a module lives in that module's single contract file,
  grouped into `describe` blocks that read top-to-bottom as happy path → edge cases → error contract.

## The fixtures helper

Everything hangs off [tests/helpers/fixtures.ts](https://github.com/getclarvis/agent-tools/blob/main/tests/helpers/fixtures.ts).
There is no mock harness because there is nothing to mock — tests run the real code against a real
temp workspace:

| Helper | Use |
|---|---|
| `makeWorkspace()` / `cleanup(root)` | `mkdtemp` a throwaway workspace under the OS temp dir, and `rm -rf` it in teardown. |
| `makeConfig(root, overrides?)` | A `ServerConfig` with the shipped defaults and `ripgrepAvailable: false` — override per test (e.g. `{ readOnly: true }`, `{ confineToWorkspace: false }`, `{ ripgrepAvailable: true }`). |
| `callTool(name, args, config)` | Wraps `dispatch` and pre-parses the result text into `{ isError, text, json }` so assertions can read `json.error` / `json.exit_code`. |
| `write` / `writeBinary` / `writeUtf16` / `read` / `exists` / `chmod` / `mode` | Seed and inspect files in the workspace (UTF-16 helper writes a BOM; `writeBinary` writes a NUL-bearing buffer). |
| `isRoot` | Guard to skip permission-dependent assertions when the suite runs as root. |

Because `makeConfig` defaults `ripgrepAvailable: false`, the default grep path in tests is the
in-process backend. `grep-parity.test.ts` flips it to `true` to assert the ripgrep and in-process
backends agree — see [internals/search.md](./internals/search.md).

## Adding a test

- **Find the module's story file, don't start a new one.** A single module's contract (its args,
  output shape, and error codes) → the existing `tests/contract/<module>.test.ts` for the tool or
  `src/lib/` primitive you touched. Anything that crosses tools or exercises the surface / config /
  statelessness → `tests/integration/`. A brand-new `tests/contract/` file only appears alongside a
  brand-new source module.
- **Name the behavior.** Write the `it(...)` title as a sentence about what the module does, then make
  the body prove it. If the honest reason for a test is "line 74 was red," stop — see
  [Every test tells a real story](#every-test-tells-a-real-story).
- **Match the glob.** Files must be named `*.test.ts` under `tests/` to be discovered.
- **Stay hermetic.** Use `makeWorkspace()` + `cleanup()` (and `makeConfig`) so every test owns its
  own directory and leaves nothing behind. Never touch the repo tree or a shared path.
- **Changing a tool contract?** Update `tests/contract/<tool>.test.ts`, the canonical
  [`SPEC.md`](../SPEC.md), and the published `docs/reference/tools.md` together.
- **Grep changes touch two backends.** Any change to matching, context, or globbing must keep the
  ripgrep and in-process paths in agreement — extend `grep-parity.test.ts`.

## See also

- [dev-commands.md](./dev-commands.md) · [CONTRIBUTING.md](../CONTRIBUTING.md)
- [internals/search.md](./internals/search.md) — the two grep backends
- [The tools reference](https://agent-tools.clarvis.dev/reference/tools) · [Error codes](https://agent-tools.clarvis.dev/reference/error-codes)
