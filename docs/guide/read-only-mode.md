# Read-only mode

> Set `readOnly: true` and the tool surface shrinks to the nine non-mutating tools. The mutating
> tools and `bash` are not registered at all — a model literally cannot call them.

## What it exposes

```ts
import { createAgentTools } from "@clarvis/agent-tools";

const tools = createAgentTools({ workspaceRoot: process.cwd(), readOnly: true });

console.log(tools.listTools().map((t) => t.name));
// [ 'read_file', 'read_image', 'list_dir', 'glob', 'grep', 'file_stat', 'tree',
//   'outline', 'check_syntax' ]
```

In read-only mode only **`read_file`**, **`read_image`**, **`list_dir`**, **`glob`**, **`grep`**,
**`file_stat`**, **`tree`**, **`outline`**, and **`check_syntax`** are exposed. `write_file`,
`edit_file`, `multi_edit`, `apply_patch`, `move`, `copy`, `mkdir`, `remove`, `bash`, and the four
`monitor_*` tools are dropped from the surface. (`outline` and `check_syntax` additionally require
the optional `@vscode/tree-sitter-wasm` peer dependency — without it they are hidden from both
surfaces, the same way read-only hides the mutating tools.)

## How a blocked call behaves

Because the mutating tools are never registered, `listTools()` doesn't advertise them and `callTool`
treats them as unknown — a call comes back as an error result with code `not_found`, not a permission
error:

```ts
import { contentText } from "@clarvis/agent-tools";

const res = await tools.callTool("write_file", { path: "x", content: "y" });
res.isError; // true
JSON.parse(contentText(res.content)).error; // "not_found"
```

This is deliberate: the read-only surface is defined by what is *registered*, so there is a single
source of truth for both advertising and dispatch. There is no separate allow-list to keep in sync.

## When to use it

- **Retrieval / RAG over a repo** — let a model read, glob, and grep to answer questions without any
  ability to change files or run commands.
- **Code review and analysis** — inspect a diff or a codebase where mutation would be out of scope.
- **Untrusted or exploratory runs** — a strong default when you're not ready to grant write or shell
  access. Note it is *not* a security boundary on its own; see below.

## Combine with confinement

Read-only removes the write and shell tools; [workspace confinement](/explanation/confinement)
(on by default) keeps the *read* tools inside the workspace root. Together they give a model that can
only read files within one directory:

```ts
const tools = createAgentTools({
  workspaceRoot: "/srv/project",
  readOnly: true,
  confineToWorkspace: true, // the default; shown for emphasis
});
```

Even so, treat these as defense-in-depth, not isolation — run the process in an OS-level sandbox.
See [Deploy securely](/operations/deploy-securely).

## argv & environment

If you drive config from argv/env via `buildConfig`, the same switch is `--read-only` or
`READ_ONLY=1` (accepts `1`/`true`/`yes`/`on`). See
[Configuration](/reference/configuration#argv-environment).

## See also

- [Configuration](/reference/configuration) — `readOnly` and every other option
- [The core API](/guide/the-core-api) — `selectSurface(readOnly)` decides the surface
- [Workspace confinement](/explanation/confinement) — the path guard that read tools still honor
