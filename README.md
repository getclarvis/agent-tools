# @clarvis/agent-tools

A minimal, opinionated set of coding tools for driving an LLM agent over a
workspace, usable as a **plain library**. It gives an agent the primitives it
needs to read, search, understand, edit, move, run, and monitor code: `read_file`,
`read_image`, `list_dir`, `glob`, `grep`, `file_stat`, `tree`, `outline`, `check_syntax`,
`write_file`, `edit_file`, `multi_edit`, `apply_patch`, `move`, `copy`, `mkdir`, `remove`,
`bash`, and the `monitor_*` background-process tools.

This package is **transport-agnostic**: it carries no built-in transport and no
agent loop — it is the tools, and nothing else. Advertise the surface, dispatch
the calls, and feed the results back from whatever agent loop or transport you
build around it.

> [!WARNING]
> These tools grant **read/write access to the workspace and arbitrary shell
> execution** with the privileges of the host process. Tool paths are **confined
> to the workspace root by default**, but `bash` runs arbitrary commands and is
> not sandboxed. Run it inside an OS-level sandbox. See [Security](#security).

## Requirements

- Node.js >= 20
- Optional: [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) on `PATH`.
  When present, `grep` uses it; otherwise an equivalent in-process fallback is
  used. Results are kept consistent between the two backends.
- Optional: [`@vscode/tree-sitter-wasm`](https://www.npmjs.com/package/@vscode/tree-sitter-wasm)
  (`npm i @vscode/tree-sitter-wasm`) — prebuilt tree-sitter runtime + grammars.
  When installed, the `outline` and `check_syntax` tools appear on the surface and
  the writing tools annotate their results with syntax warnings; when absent, both
  tools are hidden and writes are unannotated.

## Install

```bash
npm install @clarvis/agent-tools
```

## Library usage

The ergonomic entry point is `createAgentTools`. Give it a workspace root and it
resolves a config, then lets you list and call tools:

```ts
import { createAgentTools, contentText } from "@clarvis/agent-tools";

const tools = createAgentTools({ workspaceRoot: process.cwd() });

// Advertise the tool surface (name / description / JSON Schema) to your model:
tools.listTools();

// Call a tool by name with its arguments:
const res = await tools.callTool("read_file", { path: "package.json" });
if (res.isError) {
  const err = JSON.parse(contentText(res.content)) as { error: string; message: string };
  console.error(err.error, err.message);
} else {
  console.log(contentText(res.content));
}
```

`callTool` never throws for tool-level problems — it returns `{ isError, content }`,
an array of parts (a text part `{ type: "text", text }` or an image part
`{ type: "image", data, mimeType }`). Most tools return one text part (bounded to
`maxOutputBytes`) and `read_image` returns one image part; on failure `content` is a
single text part holding a JSON error envelope
(`{ "error": "<code>", "message": "...", ... }`). `contentText(content)` concatenates
the text parts. Unknown or read-only-hidden tools come back as an `isError` result with
code `not_found`.

### Options

`createAgentTools(options)` / `resolveConfig(options)` accept:

| Option               | Default      | Meaning                                                                 |
| -------------------- | ------------ | ----------------------------------------------------------------------- |
| `workspaceRoot`      | — (required) | Base directory; relative tool paths resolve against it.                 |
| `readOnly`           | `false`      | Expose only the non-mutating tools (`read_file`/`read_files`/`read_image`/`list_dir`/`glob`/`grep`/`diff`/`file_stat`/`tree`/`outline`/`check_syntax`). |
| `confineToWorkspace` | `true`       | Reject paths that escape the workspace root (`path_escape`).             |
| `maxOutputBytes`     | `131072`     | Per-result output cap (UTF-8 bytes) for reads/grep/diff/…; larger output is bounded. |
| `maxBashOutputBytes` | `16384`      | Inline cap for `bash` stdout+stderr (lower than `maxOutputBytes`); overflow spills to a `.clarvis/` file and the tail is kept inline. |
| `maxFileBytes`       | `20000000`   | Max size of an input file the text tools read; larger is rejected.      |
| `maxImageBytes`      | `5000000`    | Max size of an image `read_image` will load; larger is rejected.        |
| `bashTimeoutMs`      | `120000`     | Default `bash` timeout in milliseconds.                                  |
| `bashTimeoutMaxMs`   | `600000`     | Hard ceiling a `bash` `timeout_ms` request may reach (≥ the default).    |
| `monitorReadyTimeoutMs` | `30000`   | Default time `monitor_start` waits for `ready_when` before returning.    |
| `maxMonitors`        | `32`         | Max live background monitors at once (beyond it, `too_many_monitors`).   |
| `probeRipgrep`       | probes `rg`  | Override ripgrep detection (e.g. `() => false` in tests).               |
| `probeTreeSitter`    | probes the peer dep | Override `@vscode/tree-sitter-wasm` detection; `false` hides `outline`/`check_syntax`. |

### Lower-level API

The building blocks are exported too, for custom transports:

```ts
import { resolveConfig, dispatch, listTools, tools, type ToolDef } from "@clarvis/agent-tools";

const config = resolveConfig({ workspaceRoot: process.cwd() });
const { isError, content } = await dispatch("grep", { pattern: "TODO" }, config);
```

- `dispatch(name, args, config)` — validate (ajv, against each tool's JSON
  Schema), run the handler, bound the output, serialize errors. Returns
  `{ isError, content }` (`contentText(content)` flattens the text parts).
- `listTools(config)` — the `{ name, description, inputSchema }[]` surface for the
  active config (respects `readOnly`).
- `tools` / `readOnlyTools` / `getTool` / `selectSurface` — the raw `ToolDef`
  registry.
- `buildConfig(argv, env)` — the argv/env config builder for a CLI or
  long-running service (delegates to `resolveConfig`).
- `ToolError` / `serializeError` / `ErrorCode` — the structured error contract.

## Tools

| Tool          | Mutating | Summary                                                            |
| ------------- | -------- | ----------------------------------------------------------------- |
| `read_file`   | no       | Read a text file (UTF-8/UTF-16), with line numbers, paging, tail. |
| `read_image`  | no       | Read an image (PNG/JPEG/GIF/WebP) as a base64 image part.         |
| `list_dir`    | no       | List the entries of a directory.                                  |
| `glob`        | no       | Find files by glob, most-recently-modified first.                 |
| `grep`        | no       | Search file contents by regular expression (optionally multiline).|
| `file_stat`   | no       | Structured metadata for a path (type, size, mtime, mode) as JSON. |
| `tree`        | no       | Print a directory as an indented, gitignore-aware tree.           |
| `outline`     | no       | Symbol skeleton of a source file with line ranges (tree-sitter).  |
| `check_syntax`| no       | Parse a source file and report syntax errors (tree-sitter).       |
| `write_file`  | yes      | Create or overwrite a file (atomic).                             |
| `edit_file`   | yes      | Replace one exact occurrence of a string in a file.              |
| `multi_edit`  | yes      | Apply several `edit_file`-style edits to one file atomically.    |
| `apply_patch` | yes      | Apply a unified diff (modify/create/delete/rename) atomically.   |
| `move`        | yes      | Move/rename one file (atomic).                                   |
| `copy`        | yes      | Copy one file, binary-safe (atomic).                            |
| `mkdir`       | yes      | Create a directory and missing parents.                         |
| `remove`      | yes      | Delete one file.                                                |
| `bash`        | yes      | Run a shell command (`sh -c`) and capture stdout/stderr/exit.    |
| `monitor_start` | yes    | Start a background command (dev server, watcher); return an id, optionally waiting until ready. |
| `monitor_poll`  | yes    | Read a monitor's new output since a byte offset; report running state and exit code. |
| `monitor_stop`  | yes    | Stop a monitor (SIGTERM→SIGKILL) and remove its files.          |
| `monitor_list`  | yes    | List running and finished monitors.                             |

In read-only mode only `read_file`, `read_files`, `read_image`, `list_dir`, `glob`, `grep`,
`diff`, `file_stat`, `tree`, `outline`, and `check_syntax` are exposed. `outline` and
`check_syntax` appear (on either surface) only when the optional
`@vscode/tree-sitter-wasm` peer dependency is installed; when tree-sitter is
available, the writing tools (`write_file`/`edit_file`/`multi_edit`/`apply_patch`)
also append an advisory `warning: <language> syntax error ...` line to their
result when the written content no longer parses.

See [SPEC.md](SPEC.md) for the full per-tool contract (inputs, behavior, and
error codes).

### Output bounding

Every tool result is capped to `maxOutputBytes` (truncated on a UTF-8 character
boundary, with a marker). `bash` uses its own, smaller `maxBashOutputBytes` cap
for the inline stdout/stderr, and additionally enforces a hard per-stream
in-memory ceiling while a command runs: a command that produces unbounded output
is killed and the call returns an `output_limit` error rather than exhausting
memory. When `bash` output overflows its cap, the full captured output is written
to a `.clarvis/` spill file and the result keeps the tail inline, behind a marker
pointing at the file.

### Input bounding

The file-reading tools (`read_file`, `edit_file`, `multi_edit`, `apply_patch`,
and the in-process `grep` backend) refuse to load a file larger than
`maxFileBytes` (default 20 MB): the read/edit tools fail with `too_large`, and
`grep` skips the oversized file. `read_image` applies its own `maxImageBytes`
(default 5 MB) ceiling, also failing with `too_large`.

## Security

This is the most important property of these tools, so it is stated plainly:

- **Workspace-confined paths (default).** Every tool resolves paths against the
  workspace root and, by default, refuses any path that escapes it: `../`
  traversal, absolute paths outside the root, and symlinks inside the workspace
  that resolve outside are rejected with `path_escape`. The existing portion of a
  path is canonicalized with `realpath`, so symlink hops are caught. This guard
  can be disabled with `confineToWorkspace: false`, which restores unrestricted
  path resolution.
- **Arbitrary command execution.** `bash` runs `sh -c <command>` with the full
  privileges of the host process. Path confinement does **not** constrain a shell
  command — `bash` can read, modify, and execute anything the process can,
  regardless of the confinement setting. It is an intentional escape hatch.
- **The threat model is the host.** Because the agent driving these tools can run
  arbitrary commands, you must treat the process as having the same trust as the
  code/agent connected to it. Path confinement is defense-in-depth for the file
  tools, not a substitute for OS-level isolation.

**Run it inside an OS-level sandbox** — a container, a VM, a dedicated
low-privilege user, seccomp/AppArmor, or equivalent — scoped to the project you
intend the agent to work in. See [SECURITY.md](SECURITY.md) for the full trust
model.

## Documentation

Full guides and reference live at
**[agent-tools.clarvis.dev](https://agent-tools.clarvis.dev)** (source in
[`docs/`](docs/)):

- **Guide** — [getting started](https://agent-tools.clarvis.dev/getting-started),
  [embed in an agent](https://agent-tools.clarvis.dev/guide/embed-in-an-agent),
  [the core API](https://agent-tools.clarvis.dev/guide/the-core-api),
  [read-only mode](https://agent-tools.clarvis.dev/guide/read-only-mode),
  [limits & spill](https://agent-tools.clarvis.dev/guide/limits-and-spill).
- **Reference** — [tools](https://agent-tools.clarvis.dev/reference/tools),
  [configuration](https://agent-tools.clarvis.dev/reference/configuration),
  [createAgentTools](https://agent-tools.clarvis.dev/reference/create-agent-tools),
  [core API](https://agent-tools.clarvis.dev/reference/core-api),
  [error codes](https://agent-tools.clarvis.dev/reference/error-codes).
- **Concepts & operations** —
  [how it works](https://agent-tools.clarvis.dev/explanation/how-it-works),
  [path confinement](https://agent-tools.clarvis.dev/explanation/confinement),
  [text & encoding](https://agent-tools.clarvis.dev/explanation/text-and-encoding),
  [deploy securely](https://agent-tools.clarvis.dev/operations/deploy-securely).

The canonical per-tool contract (inputs, behavior, error codes) is
[SPEC.md](SPEC.md).

## Development

```bash
npm run build         # tsc -> dist/ (emits .d.ts)
npm test              # vitest (contract + integration)
npm run test:coverage # vitest + 95% coverage gate
npm run typecheck
npm run lint
npm run format:check
npm run pre-commit    # typecheck + format:check + test:coverage
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and
the quality gate, [`docs-internal/`](docs-internal/) for the architecture and
per-subsystem internals, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report
security issues privately per [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Clarvis
