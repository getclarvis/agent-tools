# The core API

> `createAgentTools` is a thin convenience over three exported building blocks: `resolveConfig`,
> `dispatch`, and `listTools`. Use them directly when you want to own the transport — an HTTP
> endpoint, a CLI, or a test harness.

## What the factory is

`createAgentTools` is essentially this:

```ts
import { resolveConfig, dispatch, listTools } from "@clarvis/agent-tools";

function createAgentTools(options) {
  const config = resolveConfig(options); // validate + freeze the config once
  return {
    config,
    listTools: () => listTools(config),
    callTool: (name, args = {}) => dispatch(name, args, config),
  };
}
```

So working with the core is the same three moves, unwrapped: build a `ServerConfig` once, then call
`listTools(config)` and `dispatch(name, args, config)` as needed.

## Build a config

`resolveConfig(options)` takes the same [options](/reference/configuration#options) as the factory
and returns a fully-resolved, validated `ServerConfig` (it probes for ripgrep and verifies the
workspace exists). Reuse it across every call — it is immutable.

```ts
import { resolveConfig, dispatch, listTools } from "@clarvis/agent-tools";

const config = resolveConfig({ workspaceRoot: process.cwd() });

const surface = listTools(config); // ToolInfo[]
const { isError, text } = await dispatch("grep", { pattern: "TODO" }, config);
```

For a process that reads its config from **argv and environment** instead of an options object, use
`buildConfig(argv, env)` — it parses `--workspace` / `WORKSPACE_ROOT`, `--read-only` / `READ_ONLY`,
`--allow-outside-workspace` / `ALLOW_OUTSIDE_WORKSPACE`, and the `MAX_*` / `BASH_TIMEOUT_*` env vars,
then delegates to `resolveConfig`. See [Configuration → argv & environment](/reference/configuration#argv-environment).

```ts
import { buildConfig } from "@clarvis/agent-tools";

const config = buildConfig(process.argv.slice(2), process.env);
```

## A minimal transport

Everything a transport needs is `listTools` (to advertise) and `dispatch` (to execute). Here is a
tiny JSON-over-HTTP adapter:

```ts
import { createServer } from "node:http";
import { buildConfig, dispatch, listTools } from "@clarvis/agent-tools";

const config = buildConfig(process.argv.slice(2), process.env);

createServer(async (req, res) => {
  if (req.url === "/tools") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(listTools(config)));
    return;
  }
  if (req.url === "/call" && req.method === "POST") {
    const body = JSON.parse(await readBody(req)) as { name: string; args?: Record<string, unknown> };
    const result = await dispatch(body.name, body.args ?? {}, config);
    res.statusCode = result.isError ? 400 : 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result));
    return;
  }
  res.statusCode = 404;
  res.end();
}).listen(8080);
```

`dispatch` does the validation (ajv, against each tool's JSON Schema), output bounding, and error
serialization for you — the transport just moves `{ isError, text }` across the wire.

## The raw registry

If you need the tools themselves — to filter the surface, look one up, or introspect a schema — the
registry is exported too:

- `tools` — the full array of `ToolDef` (all twenty-two tools).
- `readOnlyTools` — the non-mutating subset (`read_file`, `read_image`, `list_dir`, `glob`, `grep`,
  `file_stat`, `tree`, `outline`, `check_syntax`).
- `selectSurface(readOnly, treeSitterAvailable?)` — returns `readOnlyTools` when `true`, else
  `tools`; passing `treeSitterAvailable: false` filters `outline`/`check_syntax` out of either
  surface. This is what `listTools`/`dispatch` use to honor `config.readOnly` and
  `config.treeSitterAvailable`.
- `getTool(name, surface)` — look up one tool by name within a surface, or `undefined`.

```ts
import { tools, selectSurface, getTool } from "@clarvis/agent-tools";

const surface = selectSurface(config.readOnly);
const grep = getTool("grep", surface);
console.log(grep?.inputSchema);
```

See [Core API reference](/reference/core-api) for the exact signatures and the `ToolDef` shape.

## See also

- [Core API reference](/reference/core-api) — signatures for `dispatch`, `listTools`, the registry, and error helpers
- [Configuration](/reference/configuration) — `resolveConfig` / `buildConfig` options, env, and argv
- [How it works](/explanation/how-it-works) — what `dispatch` does step by step
