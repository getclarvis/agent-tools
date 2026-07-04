# Releasing

> The pre-publish checklist for shipping `@clarvis/agent-tools` to GitHub and npm.

This is the maintainer runbook. The first public release is **0.1.0**; the public npm registry has no
prior release of this package. `@clarvis/agent-tools` is an **importable library** (no `bin`, no
shebang) — publishing targets the public registry (npmjs.com), see [Publish](#6-publish).

## 1. GitHub repository

- [ ] `getclarvis/agent-tools` exists on GitHub and is **public** (all package metadata and doc links
      point there).
- [ ] The git remote points at it: `git remote -v` shows
      `https://github.com/getclarvis/agent-tools.git`.
- [ ] Enable **private vulnerability reporting** (Settings → Security) so the SECURITY.md advisory
      link resolves.
- [ ] Confirm the security/conduct contacts are monitored: **security@clarvis.dev** (SECURITY.md) and
      **conduct@clarvis.dev** (CODE_OF_CONDUCT.md).
- [ ] Enable **GitHub Pages** (Settings → Pages → Source: GitHub Actions) so `docs.yml` can deploy the
      site to `agent-tools.clarvis.dev`.
- [ ] Add an **`NPM_TOKEN`** repository/organization secret (an npm automation token with publish
      rights) before pushing a release tag.
- [ ] (Optional) Create an **`npm-publish`** GitHub Environment with required reviewers — the release
      workflow (`.github/workflows/release.yml`) references it, so protection rules there become a
      manual approval gate before any publish.

## 2. Quality gates

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test                 # contract + integration
npm run build            # emits dist/ with .d.ts
```

- [ ] All green.

## 3. Version & changelog

- [ ] `package.json` version is the intended release (first public: **0.1.0**).
- [ ] In `CHANGELOG.md`, the release heading carries the date (e.g. `## [0.1.0] - 2026-07-01`) and any
      **BREAKING** change to a tool contract is called out.

## 4. Inspect the package tarball

```bash
npm pack --dry-run
```

- [ ] The tarball includes `dist/`, `README.md`, `SPEC.md`, `LICENSE`, `CHANGELOG.md`,
      `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` — and nothing it shouldn't (no
      `src/`, `tests/`, `docs/`, `docs-internal/`, `.github/`). The whitelist is the `files` array in
      `package.json`; `docs-internal/` is deliberately outside it.

## 5. Smoke-test the import

```bash
npm pack
mkdir -p /tmp/at-smoke && cd /tmp/at-smoke && npm init -y >/dev/null
npm i /path/to/clarvis-agent-tools-0.1.0.tgz
node --input-type=module -e "
  import { createAgentTools } from '@clarvis/agent-tools';
  const t = createAgentTools({ workspaceRoot: process.cwd() });
  console.log(t.listTools().map(x => x.name).join(', '));
  console.log((await t.callTool('list_dir', { path: '.' })).text);
"
```

- [ ] The library imports, `listTools()` returns the twenty-five tools (twenty-three without the
      `@vscode/tree-sitter-wasm` dev/peer dependency installed), and a `read_file`/`list_dir` call
      returns a bounded result. In read-only mode only the eleven read tools appear.

## 6. Publish

Preferred: tag and let the **release workflow** publish with provenance.

```bash
git tag v0.1.0
git push origin v0.1.0     # triggers .github/workflows/release.yml
```

The workflow runs `prepublishOnly`, verifies the tag matches the `package.json` version and that the
version is ahead of the public npm `latest`, then runs `npm publish --provenance --access public`
using the `NPM_TOKEN` secret, and creates a GitHub Release.

Manual fallback (if not using the workflow), explicitly targeting the public registry:

```bash
npm publish --provenance --access public --registry=https://registry.npmjs.org
```

## 7. Post-publish

- [ ] `npm view @clarvis/agent-tools version --registry=https://registry.npmjs.org` shows the release.
- [ ] The GitHub Release exists and links the CHANGELOG.
- [ ] Install from public npm in a clean dir and re-run the smoke test.
- [ ] The docs site deployed (Actions → `docs` workflow green;
      [agent-tools.clarvis.dev](https://agent-tools.clarvis.dev) serves the new build).

## See also

- [CONTRIBUTING.md](https://github.com/getclarvis/agent-tools/blob/main/CONTRIBUTING.md)
- [SECURITY.md](https://github.com/getclarvis/agent-tools/blob/main/SECURITY.md)
- [dev-commands.md](./dev-commands.md) · [testing.md](./testing.md)
