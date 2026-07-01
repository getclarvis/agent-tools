# @clarvis/agent-tools

A minimal, opinionated set of coding tools for driving an LLM agent over a
workspace, usable as a **plain library**. It gives an agent the primitives it
needs to read, search, edit, and run code: `read_file`, `list_dir`, `glob`,
`grep`, `write_file`, `edit_file`, `multi_edit`, `apply_patch`, and `bash`.

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

## Install

```sh
npm install @clarvis/agent-tools
```

## Library usage

The ergonomic entry point is `createAgentTools`. Give it a workspace root and it
resolves a config, then lets you list and call tools:

```ts
import { createAgentTools } from "@clarvis/agent-tools";

const tools = createAgentTools({ workspaceRoot: process.cwd() });

// Advertise the tool surface (name / description / JSON Schema) to your model:
tools.listTools();

// Call a tool by name with its arguments:
const res = await tools.callTool("read_file", { path: "package.json" });
if (res.isError) {
  const err = JSON.parse(res.text) as { error: string; message: string };
  console.error(err.error, err.message);
} else {
  console.log(res.text);
}
```

`callTool` never throws for tool-level problems — it returns
`{ isError, text }`. On success `text` is the tool output (already bounded to
`maxOutputBytes`); on failure `text` is a JSON error envelope
(`{ "error": "<code>", "message": "..." , ... }`). Unknown or read-only-hidden
tools come back as an `isError` result with code `not_found`.

### Options

`createAgentTools(options)` / `resolveConfig(options)` accept:

| Option               | Default      | Meaning                                                                 |
| -------------------- | ------------ | ----------------------------------------------------------------------- |
| `workspaceRoot`      | — (required) | Base directory; relative tool paths resolve against it.                 |
| `readOnly`           | `false`      | Expose only the non-mutating tools (`read_file`/`list_dir`/`glob`/`grep`). |
| `confineToWorkspace` | `true`       | Reject paths that escape the workspace root (`path_escape`).             |
| `maxOutputBytes`     | `131072`     | Per-result output cap (UTF-8 bytes); larger output is bounded.           |
| `maxFileBytes`       | `20000000`   | Max size of an input file the text tools read; larger is rejected.      |
| `bashTimeoutMs`      | `120000`     | Default `bash` timeout in milliseconds.                                  |
| `bashTimeoutMaxMs`   | `600000`     | Hard ceiling a `bash` `timeout_ms` request may reach (≥ the default).    |
| `probeRipgrep`       | probes `rg`  | Override ripgrep detection (e.g. `() => false` in tests).               |

### Lower-level API

The building blocks are exported too, for custom transports:

```ts
import { resolveConfig, dispatch, listTools, tools, type ToolDef } from "@clarvis/agent-tools";

const config = resolveConfig({ workspaceRoot: process.cwd() });
const { isError, text } = await dispatch("grep", { pattern: "TODO" }, config);
```

- `dispatch(name, args, config)` — validate (ajv, against each tool's JSON
  Schema), run the handler, bound the output, serialize errors. Returns
  `{ isError, text }`.
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
| `list_dir`    | no       | List the entries of a directory.                                  |
| `glob`        | no       | Find files by glob, most-recently-modified first.                 |
| `grep`        | no       | Search file contents by regular expression (optionally multiline).|
| `write_file`  | yes      | Create or overwrite a file (atomic).                              |
| `edit_file`   | yes      | Replace one exact occurrence of a string in a file.              |
| `multi_edit`  | yes      | Apply several `edit_file`-style edits to one file atomically.    |
| `apply_patch` | yes      | Apply a unified diff (modify/create/delete/rename) atomically.   |
| `bash`        | yes      | Run a shell command (`sh -c`) and capture stdout/stderr/exit.    |

In read-only mode only `read_file`, `list_dir`, `glob`, and `grep` are exposed.

See [SPEC.md](./SPEC.md) for the full per-tool contract (inputs, behavior, and
error codes).

### Output bounding

Every tool result is capped to `maxOutputBytes` (truncated on a UTF-8 character
boundary, with a marker). `bash` additionally enforces a hard per-stream
in-memory ceiling while a command runs: a command that produces unbounded output
is killed and the call returns an `output_limit` error rather than exhausting
memory. When `bash` output overflows the display cap, the full captured output is
written to a `.clarvis/` spill file and the result points at it.

### Input bounding

The file-reading tools (`read_file`, `edit_file`, `multi_edit`, `apply_patch`,
and the in-process `grep` backend) refuse to load a file larger than
`maxFileBytes` (default 20 MB): the read/edit tools fail with `too_large`, and
`grep` skips the oversized file.

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
intend the agent to work in.

## Development

```sh
npm run build         # tsc -> dist/ (emits .d.ts)
npm test              # vitest
npm run typecheck
npm run lint
npm run format:check
```

## License

See [LICENSE](./LICENSE).
