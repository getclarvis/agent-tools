# `createAgentTools`

> The ergonomic entry point. It resolves a config once and returns an `AgentTools` object with
> `listTools()` and `callTool()`. This is the high-level API; the [core API](/reference/core-api)
> exposes the same behavior unwrapped.

## Signature

```ts
function createAgentTools(options: AgentToolsOptions): AgentTools;
```

`options` is the same object accepted by [`resolveConfig`](/reference/configuration) — only
`workspaceRoot` is required. Passing an invalid config (missing/nonexistent workspace, or an
out-of-range limit) throws a `StartupError` synchronously.

```ts
import { createAgentTools } from "@clarvis/agent-tools";

const tools = createAgentTools({ workspaceRoot: process.cwd() });
```

## `AgentTools`

```ts
interface AgentTools {
  readonly config: ServerConfig;
  listTools(): ToolInfo[];
  callTool(name: string, args?: Record<string, unknown>): Promise<DispatchResult>;
}
```

| Member       | Type                                                            | Description                                                                                  |
| ------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `config`     | `ServerConfig`                                                  | The fully-resolved, frozen config (see [Configuration](/reference/configuration#serverconfig)). |
| `listTools`  | `() => ToolInfo[]`                                              | The advertised surface for the active config — respects `readOnly`.                          |
| `callTool`   | `(name, args?) => Promise<DispatchResult>`                      | Validate `args`, run the tool, bound the output, serialize any error. Defaults `args` to `{}`. |

The object is a thin wrapper: `listTools()` calls `listTools(config)` and `callTool()` calls
`dispatch(name, args, config)` from the [core API](/reference/core-api).

## `ToolInfo`

```ts
interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}
```

What `listTools()` returns for each tool. `inputSchema` is a JSON Schema you can hand directly to a
model's tool-use / function-calling API. See [The tools](/reference/tools) for each tool's schema.

## `DispatchResult`

<!-- @include: @/_partials/dispatch-result.md -->

## Example

```ts
import { createAgentTools } from "@clarvis/agent-tools";

const tools = createAgentTools({ workspaceRoot: process.cwd(), readOnly: true });

for (const tool of tools.listTools()) {
  console.log(tool.name, "→", tool.description);
}

const res = await tools.callTool("grep", { pattern: "createAgentTools", output_mode: "content" });
console.log(res.isError ? JSON.parse(res.text) : res.text);
```

## See also

- [Configuration](/reference/configuration) — the `AgentToolsOptions` and `ServerConfig` shapes
- [The tools](/reference/tools) — inputs, output, and errors for each tool
- [Core API](/reference/core-api) — `dispatch` / `listTools` / the registry behind this factory
- [Embed it in an agent loop](/guide/embed-in-an-agent) — the intended usage pattern
