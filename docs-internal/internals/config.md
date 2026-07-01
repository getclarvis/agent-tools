# Internals: config subsystem

Source-level reference for config resolution. The user-facing option catalog (defaults, meanings)
lives at [configuration](https://agent-tools.clarvis.dev/reference/configuration) and
[create-agent-tools](https://agent-tools.clarvis.dev/reference/create-agent-tools); this page covers
the validation primitives, the argv/env builder, and the floors the published pages omit.

## Source files

| Path | Responsibility |
|---|---|
| [`src/config.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/config.ts) | The entire config subsystem: `ServerConfig`, `AgentToolsOptions`, the default/min constants, `resolveConfig`, `buildConfig`, the argv/env parsers, `probeRipgrep`, and `StartupError`. |
| [`src/index.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/index.ts) | Re-exports `resolveConfig` / `buildConfig` / `StartupError` and the `DEFAULT_*` constants. |

## Exports

| Symbol | Kind | Notes |
|---|---|---|
| `resolveConfig(options)` | function | Options → validated `ServerConfig`. Throws `StartupError` on bad input. Probes ripgrep once (overridable via `options.probeRipgrep`). |
| `buildConfig(argv, env, probe?)` | function | argv/env front-end (CLI / long-running service). Parses flags + vars, then delegates to `resolveConfig`. |
| `ServerConfig` / `AgentToolsOptions` | types | The resolved config, and the options accepted by `resolveConfig`/`createAgentTools`. |
| `StartupError` | class | Thrown for any invalid config; distinct from a runtime `ToolError`. |
| `DEFAULT_MAX_OUTPUT_BYTES` `DEFAULT_MAX_FILE_BYTES` `DEFAULT_BASH_TIMEOUT_MS` `DEFAULT_BASH_TIMEOUT_MAX_MS` | const | The shipped defaults, exported for callers and tests. |

Internal (not exported): `MIN_OUTPUT_BYTES` / `MIN_FILE_BYTES` (1024), `parseWorkspaceArg`,
`resolveReadOnly`, `resolveConfine`, `parsePositiveInt`, `probeRipgrep`, `validateWorkspace`,
`requireMin`, and the `READ_ONLY_TRUE` / `READ_ONLY_FALSE` string sets.

## The resolved shape

`ServerConfig` is a flat object — every field is required and set by `resolveConfig`:

| Field | Default | Floor / rule |
|---|---|---|
| `workspaceRoot` | — (required) | `path.resolve`d; must exist and be a directory (`validateWorkspace`). |
| `maxOutputBytes` | `131072` | integer ≥ `1024`. |
| `maxFileBytes` | `20_000_000` | integer ≥ `1024`. |
| `bashTimeoutMs` | `120000` | integer ≥ `1`. |
| `bashTimeoutMaxMs` | `600000` | integer ≥ `1`, and **≥ `bashTimeoutMs`** (cross-field check). |
| `ripgrepAvailable` | probed | `spawnSync("rg", ["--version"]).status === 0`. |
| `readOnly` | `false` | — |
| `confineToWorkspace` | `true` | — |

## Validation primitives

- **`requireMin(n, min, name)`** — used by `resolveConfig` for the programmatic path: rejects
  non-safe-integers and values below `min` with a `StartupError`.
- **`parsePositiveInt(value, fallback, name, min=1)`** — used by `buildConfig` for the env path:
  empty/undefined → `fallback`; otherwise the string must match `/^\d+$/`, be a safe integer, and be
  ≥ `min`.
- **`validateWorkspace(raw)`** — `path.resolve` then `statSync`; missing → "does not exist", non-dir →
  "is not a directory".
- **`probeRipgrep()`** — `spawnSync` with `stdio: "ignore"`, `true` iff exit status `0`; any throw →
  `false`. Injected as `options.probeRipgrep` / `buildConfig`'s `probe` param so tests can force it
  (`() => false` / `() => true`).

## `buildConfig`: the argv/env surface

`buildConfig` is the only place environment variables and CLI flags are read (the library core takes
none). It maps:

| Source | → option |
|---|---|
| `--workspace <path>` / `--workspace=<path>` / `WORKSPACE_ROOT` | `workspaceRoot` (flag wins) |
| `--read-only` / `READ_ONLY` (`1/true/yes/on` ↔ `0/false/no/off`) | `readOnly` |
| `--allow-outside-workspace` / `ALLOW_OUTSIDE_WORKSPACE` (same truthy set) | `confineToWorkspace` (inverted) |
| `MAX_OUTPUT_BYTES` / `MAX_FILE_BYTES` / `BASH_TIMEOUT_MS` / `BASH_TIMEOUT_MAX_MS` | the matching numeric field |

An unrecognized truthy string for `READ_ONLY` / `ALLOW_OUTSIDE_WORKSPACE` throws `StartupError`
(strict — not silently falsey). The `bashTimeoutMaxMs >= bashTimeoutMs` check runs both in
`buildConfig` (against the env values) and again inside `resolveConfig`.

## Maintainer notes

- **Add a config option:** add the field to `ServerConfig` and `AgentToolsOptions`, apply its floor in
  `resolveConfig` (via `requireMin` or a bespoke check), thread it into `buildConfig` if it should be
  env/argv-settable, then mirror it in `docs/reference/configuration.md`, `create-agent-tools.md`, and
  the README options table.
- **The library core reads no env.** Keep env parsing confined to `buildConfig`; a handler that reaches
  into `process.env` breaks the "config is passed in" contract and the statelessness guarantee.
- **`ripgrepAvailable` is resolved once**, at config time — not re-probed per call. Tests that need a
  deterministic backend set it explicitly via `makeConfig(root, { ripgrepAvailable })`.
