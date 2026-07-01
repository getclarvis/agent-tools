<!-- Thanks for contributing to @clarvis/agent-tools! -->

## Summary

<!-- What does this PR change, and why? -->

## Checklist

- [ ] `npm run pre-commit` is green (typecheck + format:check + test).
- [ ] Tests added/updated for the behavior change (`tests/contract/` for a tool contract,
      `tests/integration/` for cross-cutting behavior).
- [ ] If a **tool contract** changed, `SPEC.md`, `docs/reference/tools.md`, and the tool's contract
      test were updated together.
- [ ] If grep matching/context/globbing changed, both backends stay in agreement and
      `tests/integration/grep-parity.test.ts` was updated.
- [ ] A `CHANGELOG.md` entry was added; any **BREAKING** change to a tool/config contract is called
      out.
- [ ] Docs updated if a config option or observable behavior changed (`docs/`, and the matching
      `docs-internal/internals/` page).
- [ ] Security-sensitive paths (path confinement, `bash` / subprocess spawning, atomic writes, spill
      files) were reviewed — see `SECURITY.md`.

## Notes for reviewers

<!-- Anything reviewers should pay special attention to. -->
