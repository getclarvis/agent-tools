# Configuration

> Every option, its default, and its floor — plus the two ways to build a config: from an options
> object (`resolveConfig`, used by `createAgentTools`) or from argv and environment (`buildConfig`,
> used by CLI and long-running-service transports).

## Options {#options}

`createAgentTools(options)` and `resolveConfig(options)` accept:

| Option               | Type              | Default             | Meaning                                                                                          |
| -------------------- | ----------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `workspaceRoot`      | `string`          | — (required)        | Base directory; relative tool paths resolve against it. Must be an existing directory.           |
| `readOnly`           | `boolean`         | `false`             | Expose only the non-mutating tools (`read_file` / `read_image` / `list_dir` / `glob` / `grep` / `file_stat` / `tree` / `outline` / `check_syntax`). |
| `confineToWorkspace` | `boolean`         | `true`              | Reject paths that escape the workspace root (`path_escape`). `false` restores unrestricted paths.|
| `maxOutputBytes`     | `number`          | `131072` (128 KB)   | Per-result output cap in UTF-8 bytes. Floor `1024`.                                              |
| `maxFileBytes`       | `number`          | `20000000` (20 MB)  | Max size of an input file the text tools read; larger is rejected. Floor `1024`.                |
| `maxImageBytes`      | `number`          | `5000000` (5 MB)    | Max size of an image `read_image` will load; larger is rejected. Floor `1024`.                  |
| `bashTimeoutMs`      | `number`          | `120000` (2 min)    | Default `bash` timeout in milliseconds. Floor `1`.                                              |
| `bashTimeoutMaxMs`   | `number`          | `600000` (10 min)   | Hard ceiling a `bash` `timeout_ms` request may reach; must be ≥ `bashTimeoutMs`. Requests clamp.|
| `monitorReadyTimeoutMs` | `number`       | `30000` (30 s)      | Default time `monitor_start` waits for `ready_when` before returning. Floor `1`.                |
| `maxMonitors`        | `number`          | `32`                | Max live background monitors at once; beyond it `monitor_start` fails with `too_many_monitors`. Floor `1`. |
| `probeRipgrep`       | `() => boolean`   | probes `rg`         | Override ripgrep detection — e.g. `() => false` to force the in-process `grep` backend in tests.|
| `probeTreeSitter`    | `() => boolean`   | probes the peer dep | Override `@vscode/tree-sitter-wasm` detection — `() => false` hides `outline`/`check_syntax` and disables write syntax warnings. |

```ts
import { createAgentTools } from "@clarvis/agent-tools";

const tools = createAgentTools({
  workspaceRoot: "/srv/project",
  readOnly: false,
  maxOutputBytes: 65536,
  maxFileBytes: 10_000_000,
  bashTimeoutMs: 60000,
  bashTimeoutMaxMs: 300000,
});
```

An invalid value — a missing/nonexistent `workspaceRoot`, a limit below its floor, or a
`bashTimeoutMaxMs` below `bashTimeoutMs` — throws a `StartupError`.

## `resolveConfig` {#resolveconfig}

```ts
function resolveConfig(options: AgentToolsOptions): ServerConfig;
```

Validates the options, verifies the workspace exists, probes for ripgrep and for the optional
`@vscode/tree-sitter-wasm` peer dependency, and returns a frozen `ServerConfig`. `createAgentTools` calls it internally; call it yourself when driving the
[core API](/reference/core-api) directly.

## `ServerConfig` {#serverconfig}

The resolved config every tool receives. All fields are concrete (no optionals):

```ts
interface ServerConfig {
  workspaceRoot: string;
  maxOutputBytes: number;
  maxFileBytes: number;
  maxImageBytes: number;
  bashTimeoutMs: number;
  bashTimeoutMaxMs: number;
  monitorReadyTimeoutMs: number;
  maxMonitors: number;
  ripgrepAvailable: boolean; // whether `rg` was detected
  treeSitterAvailable: boolean; // whether @vscode/tree-sitter-wasm resolved
  readOnly: boolean;
  confineToWorkspace: boolean;
}
```

## argv & environment {#argv-environment}

For a process that reads its config from command-line flags and environment variables (a CLI, a
long-running service), use `buildConfig`:

```ts
function buildConfig(
  argv: string[],
  env: NodeJS.ProcessEnv,
  probe?: () => boolean,
): ServerConfig;
```

It parses the sources below, then delegates to `resolveConfig`.

| Setting              | Flag                          | Env var                   | Notes                                                        |
| -------------------- | ----------------------------- | ------------------------- | ------------------------------------------------------------ |
| `workspaceRoot`      | `--workspace <path>`          | `WORKSPACE_ROOT`          | Required (flag wins over env). Errors if neither is set.     |
| `readOnly`           | `--read-only`                 | `READ_ONLY`               | Env accepts `1`/`true`/`yes`/`on` (or `0`/`false`/`no`/`off`).|
| `confineToWorkspace` | `--allow-outside-workspace`   | `ALLOW_OUTSIDE_WORKSPACE` | Flag/env **disable** confinement (`true` ⇒ not confined).    |
| `maxOutputBytes`     | —                             | `MAX_OUTPUT_BYTES`        | Positive integer ≥ 1024.                                     |
| `maxFileBytes`       | —                             | `MAX_FILE_BYTES`          | Positive integer ≥ 1024.                                     |
| `maxImageBytes`      | —                             | `MAX_IMAGE_BYTES`         | Positive integer ≥ 1024.                                     |
| `bashTimeoutMs`      | —                             | `BASH_TIMEOUT_MS`         | Positive integer.                                            |
| `bashTimeoutMaxMs`   | —                             | `BASH_TIMEOUT_MAX_MS`     | Positive integer; must be ≥ `BASH_TIMEOUT_MS`.               |
| `monitorReadyTimeoutMs` | —                          | `MONITOR_READY_TIMEOUT_MS`| Positive integer.                                            |
| `maxMonitors`        | —                             | `MAX_MONITORS`            | Positive integer.                                            |

A malformed value (a non-integer limit, an unrecognized boolean, `--workspace` with no argument)
throws a `StartupError` with a message naming the offending setting.

```ts
import { buildConfig } from "@clarvis/agent-tools";

const config = buildConfig(process.argv.slice(2), process.env);
```

## See also

- [createAgentTools](/reference/create-agent-tools) — the factory that wraps `resolveConfig`
- [The core API](/guide/the-core-api) — using `resolveConfig` / `buildConfig` with `dispatch`
- [Limits & spill](/guide/limits-and-spill) — what the byte and timeout limits do at runtime
- [Workspace confinement](/explanation/confinement) — what `confineToWorkspace` enforces
