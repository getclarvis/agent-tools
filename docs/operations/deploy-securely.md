# Deploy securely

> These tools grant read/write access to a workspace and **arbitrary shell execution** with the
> privileges of the host process. This page is the short, blunt version of how to run them without
> handing your machine to a model.

## The one rule

**Run the process inside an OS-level sandbox**, scoped to the project you intend the agent to work
in:

- a **container** (Docker/Podman) with only the project mounted, or
- a **VM**, or
- a **dedicated low-privilege user** with filesystem ACLs, or
- **seccomp / AppArmor / Landlock** confinement, or equivalent.

Everything below is defense-in-depth *on top of* that boundary — not a replacement for it.

## Why the sandbox is non-negotiable

[Workspace confinement](/explanation/confinement) guards the **file** tools, but `bash` runs
`sh -c <command>` with the full privileges of the process. A shell command can read, write, and
execute anything the process can, regardless of the confinement setting. So the trust boundary is the
**process**: assume whatever drives these tools can run arbitrary code as that user.

## Layer these on top

- **Confine to the workspace (default).** Keep `confineToWorkspace: true` so a stray path in a file
  tool is a `path_escape`, not a host read. Only disable it when the root genuinely isn't your trust
  boundary.
- **Drop write and shell when you can.** If the agent only needs to read, use
  [`readOnly: true`](/guide/read-only-mode) — the mutating tools and `bash` aren't even registered.
- **Run as an unprivileged user** with no access outside the project directory, no ambient cloud
  credentials, and a minimal `PATH`.
- **Scope the environment.** Don't export secrets the agent doesn't need into the process env —
  `bash` can read all of it. Inject only what a run requires.

## Tune the limits

The [limits](/guide/limits-and-spill) exist so one call can't exhaust memory or flood context. In a
long-lived or multi-tenant deployment:

- Set **`maxOutputBytes`** and **`maxFileBytes`** to match your context budget and the repos you
  expect.
- Set a **`bashTimeoutMs`** / **`bashTimeoutMaxMs`** that fits your longest legitimate build or test,
  and no more — a runaway command is killed at the ceiling.
- **Sweep spill files and reap monitors.** `bash` overflow is written under `.clarvis/`, and the
  background `monitor_*` tools write `.clarvis/monitor-<id>.*` sidecars whose process outlives the
  call. Call `sweepSpillDir(root)` and `sweepMonitors(root)` periodically (startup, or on a timer) so
  old spill files and the sidecars of exited monitors don't accumulate — and use `monitor_list` /
  `monitor_stop` to stop any leaked monitor still running.

```ts
import { createAgentTools, sweepSpillDir, sweepMonitors } from "@clarvis/agent-tools";

const root = "/srv/project";
const tools = createAgentTools({
  workspaceRoot: root,
  maxOutputBytes: 65536,
  maxFileBytes: 10_000_000,
  bashTimeoutMs: 60000,
  bashTimeoutMaxMs: 300000,
});

setInterval(() => void sweepSpillDir(root), 60 * 60 * 1000); // hourly spill cleanup
setInterval(() => void sweepMonitors(root), 60 * 60 * 1000); // reap exited monitors
```

## Checklist

- [ ] Process runs in a container / VM / low-priv user scoped to one project
- [ ] `confineToWorkspace` left on (or off only with a deliberate reason)
- [ ] `readOnly` on where writes and shell aren't needed
- [ ] No unnecessary secrets in the process environment
- [ ] `maxOutputBytes` / `maxFileBytes` / `bash` timeouts tuned for the workload
- [ ] Spill files swept and exited monitors reaped on a schedule

## See also

- [Workspace confinement](/explanation/confinement) — what the path guard does and doesn't cover
- [Read-only mode](/guide/read-only-mode) — the smallest surface
- [Limits & spill](/guide/limits-and-spill) — the runtime bounds and cleanup
