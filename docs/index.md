---
layout: home

hero:
  name: "@clarvis/agent-tools"
  text: The coding tools your agent needs — as a plain library
  tagline: Twenty batteries-included tools to read, search, edit, patch, move, run, and monitor code over a workspace. Transport-agnostic and confined to your workspace by default — embed them in any agent loop, or drive them from a transport of your own.
  image:
    src: /logo.svg
    alt: "@clarvis/agent-tools"
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: The tools
      link: /reference/tools
    - theme: alt
      text: View on GitHub
      link: https://github.com/getclarvis/agent-tools

features:
  - icon: 📖
    title: Read, search, navigate
    details: read_file with line numbers, paging, and tail; list_dir; glob sorted newest-first; and grep — ripgrep-backed when available, with an equivalent in-process fallback that returns identical results.
  - icon: ✏️
    title: Edit with intent
    details: write_file for whole files, edit_file with exact-then-whitespace-tolerant matching, multi_edit for several edits in one atomic call, and apply_patch for multi-file unified diffs (modify, create, delete, rename).
  - icon: 🖥️
    title: Run anything
    details: bash runs sh -c with per-request timeouts, a hard output ceiling, and overflow spilled to a .clarvis file. A non-zero exit is a normal result — you get { exit_code, stdout, stderr, signal, timed_out }, not an exception. And the monitor_* tools run long-lived processes — a dev server, a watcher, tail -f — in the background, so you can start one, poll its output by byte offset, and stop it on demand.
  - icon: 🛡️
    title: Confined by default
    details: Every tool resolves paths against the workspace root and refuses to escape it — ../ traversal, absolute paths, and symlink hops are rejected with path_escape after realpath canonicalization. bash is the one intentional escape hatch.
  - icon: 🧩
    title: Transport-agnostic
    details: No runtime framework, no transport baggage, ESM. createAgentTools() hands you listTools() and callTool(); drop them into any agent loop, or use the low-level dispatch/registry to build whatever transport you need.
  - icon: 🔒
    title: Bounded & predictable
    details: Output is capped to a byte budget on a UTF-8 boundary, input files are size-limited, mutations are atomic (temp file + rename with rollback), and every failure is one structured JSON error envelope.
---

## What it gives your agent

`@clarvis/agent-tools` is the tool layer for an LLM coding agent, packaged as a library you call
directly. You give it a workspace root; it gives you a validated, bounded, workspace-confined surface
of twenty tools — the primitives an agent needs to read, search, edit, move, run, and monitor code:

- **Advertise a tool surface to your model.** `listTools()` returns each tool's `name`,
  `description`, and JSON Schema — hand it straight to a model's tool-use API.
- **Call tools safely.** `callTool(name, args)` validates arguments against the schema, runs the
  handler, bounds the output, and never throws for tool-level problems — you always get
  `{ isError, content }` back.
- **Keep the agent inside the workspace.** File paths are confined to the root by default; a stray
  `../` or absolute path comes back as a `path_escape` error rather than touching the host.
- **Get typed, honest results.** Success is content parts — text for most tools, a JSON object for
  `bash` and the `monitor_*` tools, a base64 image for `read_image`; failure is a text part with a
  stable `error` code.

It carries **no transport** and **no built-in agent loop** — it is the tools, and nothing else.
Advertise the surface, dispatch the calls, feed the results back; how the tools reach your model is
entirely up to you.

## Install

```bash
npm install @clarvis/agent-tools
```

Node ≥ 20, ESM only. Optional: [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) on `PATH` —
`grep` uses it when present and falls back to an in-process implementation otherwise.

## Quick start

```ts
import { createAgentTools, contentText } from "@clarvis/agent-tools";

const tools = createAgentTools({ workspaceRoot: process.cwd() });

// Advertise the surface (name / description / JSON Schema) to your model:
const surface = tools.listTools();

// Call a tool by name with its arguments:
const res = await tools.callTool("read_file", { path: "package.json" });
if (res.isError) {
  const err = JSON.parse(contentText(res.content)) as { error: string; message: string };
  console.error(err.error, err.message);
} else {
  console.log(contentText(res.content));
}
```

## Two ways in

**Use the factory.** `createAgentTools(options)` resolves a config once and returns `listTools()` /
`callTool()` — the ergonomic path for wiring the tools into an agent loop. Start with
[Getting started](/getting-started), then [Embed it in an agent loop](/guide/embed-in-an-agent).

**Drive the core directly.** The building blocks — `resolveConfig`, `dispatch`, `listTools`, and the
raw tool registry — are exported too, for building your own transport (an HTTP endpoint, a CLI, a
test harness). See [The core API](/guide/the-core-api).

## Built for safety

These tools grant **read/write access to the workspace and arbitrary shell execution** with the
privileges of the host process. Path confinement is defense-in-depth for the file tools — it is
**not** a sandbox, and it does not constrain `bash`. Run the process inside an OS-level sandbox
scoped to the project. See [Workspace confinement](/explanation/confinement) and
[Deploy securely](/operations/deploy-securely).
