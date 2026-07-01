# Guide

> How to use `@clarvis/agent-tools` in practice: wire it into an agent loop, drive the core directly
> for a custom transport, run it read-only, and tune its output and input limits. Every page here is
> task-oriented; the [Reference](/reference/create-agent-tools) has the exhaustive contracts.

## Pick your level

### The factory — for embedding in an agent loop

`createAgentTools(options)` resolves a config once and returns `listTools()` / `callTool()`. This is
what most consumers want: advertise the surface to a model, then dispatch the tool calls the model
makes.

→ **[Embed it in an agent loop](/guide/embed-in-an-agent)**

### The core — for building your own transport

The building blocks — `resolveConfig`, `dispatch`, `listTools`, and the raw tool registry — are
exported so you can expose the tools however you like: an HTTP endpoint, a CLI, or a test harness.

→ **[The core API](/guide/the-core-api)**

## Then tune it

- **[Read-only mode](/guide/read-only-mode)** — expose only `read_file` / `list_dir` / `glob` /
  `grep`, and drop the mutating tools entirely.
- **[Limits & spill](/guide/limits-and-spill)** — how output is bounded, how oversized input is
  refused, and how `bash` overflow spills to disk.

## See also

- [Getting started](/getting-started) — install and a first read/edit
- [Configuration](/reference/configuration) — every option and its default
- [How it works](/explanation/how-it-works) — the dispatch pipeline behind `callTool`
