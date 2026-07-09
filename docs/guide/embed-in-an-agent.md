# Embed it in an agent loop

> The core pattern: advertise the tool surface to a model, let the model choose tool calls, dispatch
> each one with `callTool`, and feed the result back. `@clarvis/agent-tools` gives you the tools and
> the dispatch — you own the model call and the loop.

## The cycle

An agent loop with these tools is one repeated cycle:

1. **Advertise** — send `tools.listTools()` to the model as its tool/function schema.
2. **Model call** — the model replies with text and/or tool calls.
3. **Dispatch** — for each tool call, run `tools.callTool(name, args)`.
4. **Feed back** — attach each `{ isError, content }` to the conversation as a tool result.
5. **Repeat** until the model stops calling tools (or you hit your own budget).

```text
   your conversation ──▶ model ──▶ tool calls
          ▲                              │
          │                              ▼
   tool results ◀── callTool(name, args) for each
```

`@clarvis/agent-tools` owns step 3 only. Steps 1, 2, 4, and the loop are yours — which keeps the
package free of any provider or framework dependency.

## Wiring the surface

`listTools()` returns `{ name, description, inputSchema }[]`, where `inputSchema` is a JSON Schema.
Most tool-use APIs take exactly that shape, so the mapping is direct:

```ts
import { createAgentTools } from "@clarvis/agent-tools";

const tools = createAgentTools({ workspaceRoot: process.cwd() });

const toolSchema = tools.listTools().map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema, // rename the key to whatever your model API expects
}));
```

## Dispatching a turn

When the model returns tool calls, dispatch each and turn the result into a tool-result message. The
result's `isError` maps to whatever "this tool call failed" flag your model API uses:

```ts
import { contentText } from "@clarvis/agent-tools";

async function runToolCalls(calls: { id: string; name: string; args: Record<string, unknown> }[]) {
  return Promise.all(
    calls.map(async (call) => {
      const res = await tools.callTool(call.name, call.args);
      return {
        tool_call_id: call.id,
        is_error: res.isError,
        content: contentText(res.content), // flatten text parts — already byte-bounded
      };
    }),
  );
}
```

`res.content` is an array of parts — text parts (`{ type: "text", text }`) and, for `read_image`,
an image part (`{ type: "image", data, mimeType }`). `contentText(content)` concatenates the text
parts; to pass an image to a vision model, forward the image part in whatever shape your API expects
instead of flattening.

A few things to know when you feed results back:

- **The text parts are already bounded.** On success each is capped to `maxOutputBytes` on a UTF-8
  boundary, with a truncation marker if it was cut. You do not need to trim it again. See
  [Limits & spill](/guide/limits-and-spill).
- **`bash` returns JSON.** Its success text part is `{ exit_code, stdout, stderr, signal, timed_out }`.
  A non-zero `exit_code` is **not** an error (`isError` is `false`) — surface it to the model as-is
  so it can react to a failed build or test.
- **Errors are self-describing.** On failure, `content` is a single text part holding a JSON envelope
  `{ "error": "<code>", "message": "…" }`. Passing it straight back lets the model correct itself
  (e.g. fix an `ambiguous_match` by adding more context to `old_string`).
- **Validation is LLM-tolerant.** The tools are strict about fields that affect behavior and safety,
  but tolerant of harmless LLM artifacts such as extra arguments and string-encoded primitive values.
  A well-intentioned call rarely produces `invalid_input` — you do not need to pre-validate the
  model's arguments before dispatching.

## Running calls in parallel

`dispatch` is stateless — a fresh call per invocation — so independent tool calls in one model turn
can run concurrently (as in `Promise.all` above). Writes to the **same path** are serialized by an
in-process lock and each mutation is atomic (temp file + `rename`), so concurrent edits do not
interleave. This is a single-process contract: separate processes or external editors are not
coordinated.

## Read-only and confinement

By default every path is confined to the workspace root, so a model that hallucinates `../../etc`
gets a `path_escape` error instead of reaching the host. If the agent only needs to inspect code,
construct the surface with `readOnly: true` to drop the mutating tools and `bash` entirely — see
[Read-only mode](/guide/read-only-mode). Neither is a substitute for OS-level isolation; see
[Deploy securely](/operations/deploy-securely).

## See also

- [The core API](/guide/the-core-api) — skip the factory and dispatch against a config directly
- [The tools](/reference/tools) — the arguments and output of each tool you're advertising
- [createAgentTools](/reference/create-agent-tools) — the `AgentTools` / `ToolInfo` / `DispatchResult` types
- [Error codes](/reference/error-codes) — the `error` values a model may need to recover from
