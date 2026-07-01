# Limits & spill

> Tool output is bounded so one call can't flood your context or your memory, and oversized input
> files are refused rather than loaded. `bash` output that overflows the display cap is spilled to a
> file you can read on demand. This page covers the three limits and how to tune them.

## Output bounding

Every tool result is capped to `maxOutputBytes` (default **131072** = 128 KB). When output exceeds
the cap it is truncated on a **UTF-8 character boundary** (never mid-multibyte) and a marker is
appended so the reader knows it was cut. Because `callTool`'s `text` is already bounded, you can feed
it back to a model without re-trimming.

```ts
const tools = createAgentTools({ workspaceRoot: process.cwd(), maxOutputBytes: 65536 }); // 64 KB
```

The minimum is 1024 bytes; values below it are rejected when the config is built.

## `bash` output: hard ceiling and spill

`bash` is the one tool that can produce unbounded output while it runs, so it has an extra layer:

- **Hard per-stream in-memory ceiling.** A command that keeps writing without end is killed (its
  whole process group) and the call fails with `output_limit`, rather than exhausting memory.
- **Spill on overflow.** When a *completed* command's combined stdout+stderr exceeds the display cap,
  the full captured output is written to a spill file under `.clarvis/` in the workspace, and the
  bounded result points at it. You get the truncated view inline and the complete output on disk.

The spill directory is created with its own `.gitignore`, so spill files never end up tracked. To
clean up old spill files, call `sweepSpillDir`:

```ts
import { sweepSpillDir } from "@clarvis/agent-tools";

await sweepSpillDir(process.cwd()); // async; removes stale .clarvis spill files
```

Run it periodically (e.g. at startup, or on a timer) if your process is long-lived.

## Input bounding

The file-reading tools refuse a file larger than `maxFileBytes` (default **20000000** = 20 MB):

- `read_file`, `edit_file`, `multi_edit`, and `apply_patch` fail with **`too_large`**.
- The in-process `grep` backend **skips** the oversized file (ripgrep, when used, applies its own
  limits).

```ts
const tools = createAgentTools({ workspaceRoot: process.cwd(), maxFileBytes: 10_000_000 }); // 10 MB
```

The minimum is 1024 bytes.

## `bash` timeouts

`bash` blocks until the command exits. Its default timeout is `bashTimeoutMs` (**120000** = 2 min),
and a per-call `timeout_ms` may raise it up to `bashTimeoutMaxMs` (**600000** = 10 min). A request
above the ceiling is **clamped**, not rejected. On timeout the process group is killed and the call
returns `timeout` with whatever partial output was captured.

```ts
const tools = createAgentTools({
  workspaceRoot: process.cwd(),
  bashTimeoutMs: 60000, // default 1 min
  bashTimeoutMaxMs: 300000, // ceiling 5 min (must be >= bashTimeoutMs)
});
```

Long-lived processes (dev servers, watchers) must be backgrounded with output redirected — e.g.
`npm start > /tmp/out.log 2>&1 &` — or they will hit the timeout.

## Defaults at a glance

| Limit             | Option            | Default             | Floor / rule                         |
| ----------------- | ----------------- | ------------------- | ------------------------------------ |
| Output cap        | `maxOutputBytes`  | `131072` (128 KB)   | ≥ 1024                               |
| Input file cap    | `maxFileBytes`    | `20000000` (20 MB)  | ≥ 1024                               |
| `bash` timeout    | `bashTimeoutMs`   | `120000` (2 min)    | ≥ 1                                  |
| `bash` timeout max| `bashTimeoutMaxMs`| `600000` (10 min)   | ≥ `bashTimeoutMs`; requests clamped  |

## See also

- [Configuration](/reference/configuration) — all options, defaults, and env/argv equivalents
- [The tools → bash](/reference/tools#bash) — the full `bash` contract
- [Deploy securely](/operations/deploy-securely) — spill cleanup and limit tuning in production
