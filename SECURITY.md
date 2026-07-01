# Security Policy

## Supported versions

This project is pre-1.0. Security fixes are applied to the latest published `0.x` release.

## Trust model

`@clarvis/agent-tools` is a **library** that gives an agent read/write access to a workspace and
**arbitrary shell execution** with the privileges of the host process. It carries no transport and no
sandbox of its own. Two boundaries matter:

- **File tools are workspace-confined by default.** `read_file`, `list_dir`, `glob`, `grep`,
  `write_file`, `edit_file`, `multi_edit`, and `apply_patch` resolve every path against the workspace
  root and, with `confineToWorkspace: true` (the default), reject any path that escapes it — `../`
  traversal, an absolute path outside the root, or a symlink whose real target lies outside — with
  `path_escape`. The existing prefix of a target path is canonicalized with `realpath`, so symlink
  hops are caught. Writes additionally refuse to write **through** a symlink at the target itself,
  regardless of the confinement setting.
- **`bash` is an intentional escape hatch.** It runs `sh -c <command>` (detached, in its own process
  group) with the full privileges of the host process. Path confinement does **not** constrain a
  shell command — `bash` can read, modify, and execute anything the process can, whatever
  `confineToWorkspace` is set to. Only its working directory is validated.

Because the agent driving these tools can run arbitrary commands, the trust model is the **host**:

> **Run `@clarvis/agent-tools` inside an OS-level sandbox** — a container, a VM, a dedicated
> low-privilege user, seccomp/AppArmor, or equivalent — scoped to the project you intend the agent to
> work in. Path confinement is defense-in-depth for the file tools, not a substitute for OS-level
> isolation.

### Defense-in-depth notes

- **Output is bounded.** Every tool result is capped to `maxOutputBytes` (UTF-8-safe truncation). A
  `bash` command that produces unbounded output on a single stream is killed at a per-stream capture
  ceiling and returns `output_limit`, rather than exhausting memory.
- **Spill files stay in-workspace.** When `bash` output overflows the display cap, the full stream is
  written to a `.clarvis/` spill file (auto-`.gitignore`d) inside the workspace and the result points
  at it; nothing is written outside the workspace. `sweepSpillDir()` prunes old spill files.
- **Writes are atomic.** Mutating tools stage to a temp file, fsync, and rename, so a crash mid-write
  never truncates the target; `apply_patch` rolls back a failed multi-file change and preserves the
  original content in an adjacent backup if rollback itself fails.
- **Confinement is configurable.** `confineToWorkspace: false` (or `ALLOW_OUTSIDE_WORKSPACE=1`)
  removes the path guard for the file tools. Only disable it when the process is already sandboxed and
  you intend the tools to reach outside the workspace.
- **Errors don't leak internals.** A non-`ToolError` throw is logged to stderr and returned to the
  caller only as an opaque `{ "error": "internal" }` envelope; coded `ToolError`s carry structured
  fields (paths, sizes, bounded stdout/stderr) but no raw secrets.

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public issue for a vulnerability.

- Use GitHub's [private vulnerability reporting](https://github.com/getclarvis/agent-tools/security/advisories/new), or
- email the maintainers at **security@clarvis.dev**.

We aim to acknowledge reports within a few business days and will coordinate a fix and disclosure
timeline with you.
