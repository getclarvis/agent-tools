# Getting started

> `@clarvis/agent-tools` is a transport-agnostic library that gives an LLM agent twenty coding tools
> over a workspace. You give it a workspace root; it gives you a validated, bounded, workspace-confined
> surface you can advertise to a model and call. This page takes you from install to a first read and
> a first edit.

## Install

```bash
npm install @clarvis/agent-tools
```

- **Node ≥ 20, ESM only.** The package ships ES modules with type declarations; there is no CommonJS
  build. Import it from an ESM module (or a `.mts` / `"type": "module"` project).
- **Optional ripgrep.** If [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) is on `PATH`,
  `grep` uses it; otherwise an equivalent in-process backend runs. Results are kept consistent
  between the two.

## Your first tools instance

The ergonomic entry point is `createAgentTools`. Give it a workspace root — an **existing directory**
that all relative tool paths resolve against — and it resolves a config, then lets you list and call
tools.

```ts
import { createAgentTools, contentText } from "@clarvis/agent-tools";

const tools = createAgentTools({ workspaceRoot: process.cwd() });

// The surface to advertise to your model: name / description / JSON Schema per tool.
const surface = tools.listTools();
console.log(surface.map((t) => t.name));
// [ 'read_file', 'read_image', 'list_dir', 'glob', 'grep',
//   'write_file', 'edit_file', 'multi_edit', 'apply_patch', 'bash',
//   'monitor_start', 'monitor_poll', 'monitor_stop', 'monitor_list',
//   'move', 'copy', 'mkdir', 'remove', 'file_stat', 'tree' ]
```

Each entry of `listTools()` is `{ name, description, inputSchema }`, where `inputSchema` is a JSON
Schema you can hand straight to a model's tool-use / function-calling API.

## Call a tool

`callTool(name, args)` validates `args` against the tool's schema, runs it, and returns a
`DispatchResult`:

```ts
const res = await tools.callTool("read_file", { path: "package.json" });

if (res.isError) {
  const err = JSON.parse(contentText(res.content)) as { error: string; message: string };
  console.error(err.error, err.message);
} else {
  console.log(contentText(res.content)); // file contents, line-numbered and byte-bounded
}
```

## The result contract

`callTool` **never throws** for tool-level problems — it always resolves to `{ isError, content }`,
an array of content parts (`contentText(content)` concatenates the text parts):

- **On success** (`isError: false`), most tools return one text part, already bounded to
  `maxOutputBytes`. `bash`'s text part is a JSON object (`{ exit_code, stdout, stderr, signal,
  timed_out }`) — a non-zero exit is still a success — and `read_image` returns a single image part
  (`{ type: "image", data, mimeType }`).
- **On failure** (`isError: true`), `content` is a single text part holding a JSON **error envelope**:
  `{ "error": "<code>", "message": "…", …fields }`. An unknown tool name — or a mutating tool while
  in [read-only mode](/guide/read-only-mode) — comes back as an `isError` result with code
  `not_found`.

See [Error codes](/reference/error-codes) for the full list of `error` values.

## Make a change

Mutating tools work the same way. Overwrite or create a file with `write_file`, then adjust it with
`edit_file`:

```ts
await tools.callTool("write_file", {
  path: "notes.txt",
  content: "hello\nworld\n",
});

const edit = await tools.callTool("edit_file", {
  path: "notes.txt",
  old_string: "world",
  new_string: "agent-tools",
});
console.log(contentText(edit.content)); // "Replaced 1 occurrence …"
```

`edit_file` matches `old_string` **literally and exactly** first; only when an exact match fails does
it fall back to a whitespace-tolerant search, and only if that resolves to exactly one region. See
[The tools](/reference/tools#edit_file) for the matching rules.

## Two API levels

- **Factory** — `createAgentTools(options)` resolves a config once and returns `listTools()` /
  `callTool()`. This is what most consumers want; wire it into your loop with
  [Embed it in an agent loop](/guide/embed-in-an-agent).
- **Core** — `resolveConfig`, `dispatch`, `listTools`, and the raw tool registry are exported for
  building your own transport. See [The core API](/guide/the-core-api).

## See also

- [Embed it in an agent loop](/guide/embed-in-an-agent) — the read → model → `callTool` → feed-back cycle
- [Configuration](/reference/configuration) — every option and its default
- [The tools](/reference/tools) — per-tool inputs, output, and error codes
- [Workspace confinement](/explanation/confinement) · [Deploy securely](/operations/deploy-securely)
