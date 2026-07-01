# Internals: path confinement

Source-level reference for the workspace boundary. The user-facing security model lives at
[confinement](https://agent-tools.clarvis.dev/explanation/confinement) and [SECURITY.md](../../SECURITY.md);
this page covers the canonicalization mechanics and the not-yet-existing-path handling the published
page omits.

## Source files

| Path | Responsibility |
|---|---|
| [`src/lib/paths.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/paths.ts) | `resolvePath`, `displayPath`, and the internal `assertWithinWorkspace` / `canonicalize` / `canonicalizeAllowingMissing`. |
| [`src/lib/atomic.ts`](https://github.com/getclarvis/agent-tools/blob/main/src/lib/atomic.ts) | `assertNotSymlink` — the write-time symlink refusal (complements confinement). |

## Exports

| Symbol | Kind | Notes |
|---|---|---|
| `resolvePath(input, workspaceRoot, confine=false)` | function | Absolutize `input` (relative → resolved against root), and if `confine` assert it stays within the root. Returns the absolute path. |
| `displayPath(absPath, workspaceRoot)` | function | Workspace-relative path for messages/output; `"."` for the root, the absolute path when it lies outside. |

`assertWithinWorkspace`, `canonicalize`, and `canonicalizeAllowingMissing` are internal.

## How confinement works

`resolvePath` is the single choke point every file tool calls:

```ts
const abs = path.isAbsolute(input) ? path.normalize(input) : path.resolve(workspaceRoot, input);
if (confine) assertWithinWorkspace(abs, workspaceRoot, input);
return abs;
```

`assertWithinWorkspace` compares **canonicalized** paths, so symlink hops can't smuggle a path out:

1. `rootReal = canonicalize(workspaceRoot)` — `realpathSync.native`, falling back to
   `path.normalize` if the root can't be resolved.
2. `targetReal = canonicalizeAllowingMissing(abs)` — see below.
3. Reject with `path_escape` unless `targetReal === rootReal` **or** `targetReal` starts with
   `rootReal + path.sep`. The `+ path.sep` matters: it stops a sibling like `/ws-evil` from passing
   the prefix test against `/ws`.

The error message names the offending input and hints `set ALLOW_OUTSIDE_WORKSPACE=1 to permit`; the
`fields` carry `{ path: input }`.

## Canonicalizing a path that doesn't exist yet

A write can target a file that isn't created yet, so we can't `realpath` the whole path.
`canonicalizeAllowingMissing` walks **up** from `abs` until it finds an existing ancestor, canonical­
izes that real prefix, then re-joins the non-existent tail:

```text
abs = /ws/a/b/new.txt   (only /ws/a exists)
  → climb: new.txt, b are missing; /ws/a exists
  → real = realpath(/ws/a)
  → result = join(real, "b", "new.txt")
```

This means a symlink anywhere in the **existing** prefix is resolved (and thus caught if it escapes),
while the yet-to-be-created tail is taken literally. If the climb reaches the filesystem root without
finding an existing dir, it returns `path.normalize(abs)`.

## Two independent guards

Confinement is defense-in-depth for **path resolution**. Writes add a second, always-on guard:
`assertNotSymlink` ([atomic.ts](./atomic-writes.md)) refuses to write **through** a symlink at the
target itself (`invalid_input`, "Refusing to write through a symlink"), regardless of
`confineToWorkspace`. So even with confinement off, a writer won't clobber the target of a symlink.

`bash` is **not** covered by either guard for its command — only its `cwd` passes through
`resolvePath`. The shell can read/write anything the process can. See
[SECURITY.md](../../SECURITY.md).

## Maintainer notes

- **Every new file tool must route its paths through `resolvePath(input, workspaceRoot,
  config.confineToWorkspace)`** — never build an absolute path by hand and skip the check.
- **Don't `realpath` the full target of a write** — a not-yet-created file has no realpath; use
  `canonicalizeAllowingMissing` semantics (already handled inside `resolvePath`).
- **Confinement off ≠ symlink-write allowed.** The `assertNotSymlink` guard is orthogonal; keep it.
- Confinement is tested in `tests/contract/symlink.test.ts` and `tests/integration/no-isolation.test.ts`
  (the `confineToWorkspace: false` path).
