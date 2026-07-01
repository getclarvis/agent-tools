# Workspace confinement

> By default every file tool resolves paths against the workspace root and refuses to leave it. This
> is the most important property of the package — and also its limits: confinement is
> defense-in-depth for the *file* tools, not a sandbox, and it does not constrain `bash`.

## The rule

With `confineToWorkspace: true` (the default), a path is resolved and then checked against the
workspace root. These are rejected with **`path_escape`**:

- `../` traversal that climbs above the root,
- absolute paths that point outside the root,
- symlinks inside the workspace that resolve to a target outside it.

The existing portion of a path is canonicalized with `realpath` before the check, so a symlink hop
can't smuggle you out — the guard sees where the link actually points. A relative path resolves
against the root; an absolute path is taken verbatim and then checked.

```ts
const tools = createAgentTools({ workspaceRoot: "/srv/project" });

await tools.callTool("read_file", { path: "src/index.ts" }); // ok — inside the root
await tools.callTool("read_file", { path: "../../etc/passwd" }); // path_escape
await tools.callTool("read_file", { path: "/etc/passwd" }); // path_escape
```

## Turning it off

`confineToWorkspace: false` (or `--allow-outside-workspace` / `ALLOW_OUTSIDE_WORKSPACE=1` when using
`buildConfig`) restores unrestricted path resolution — the file tools may then read and write
anywhere the process can. Only do this when the workspace root genuinely isn't the trust boundary
(and pair it with OS-level isolation).

## `bash` is the escape hatch

Path confinement guards the **file** tools. `bash` runs `sh -c <command>` with the full privileges of
the host process, and a shell command can read, modify, and execute anything the process can —
**regardless of the confinement setting**. `cwd` is confined, but the command itself is not: `cat
/etc/passwd` from a confined workspace still runs. This is intentional; `bash` is an explicit escape
hatch. If you don't want it, use [read-only mode](/guide/read-only-mode), which drops `bash`
entirely.

## The threat model is the host

Because the agent driving these tools can (via `bash`) run arbitrary commands, treat the process as
having the same trust as the code or agent connected to it. Confinement narrows the blast radius of
the *file* tools against a confused or hallucinating model — it is **not** a substitute for isolating
the process:

> Run it inside an OS-level sandbox — a container, a VM, a dedicated low-privilege user,
> seccomp/AppArmor, or equivalent — scoped to the project you intend the agent to work in.

## See also

- [Deploy securely](/operations/deploy-securely) — concrete sandboxing guidance
- [Read-only mode](/guide/read-only-mode) — drop the write tools and `bash`
- [Configuration](/reference/configuration) — `confineToWorkspace` and its env/argv forms
- [Error codes](/reference/error-codes) — `path_escape`
