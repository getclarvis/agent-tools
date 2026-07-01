import { promises as fs } from "node:fs";
import path from "node:path";
import { ToolError } from "../errors.js";
import { uniqueToken } from "./token.js";

const locks = new Map<string, Promise<unknown>>();

export function withFileLock<T>(absPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(absPath) ?? Promise.resolve();

  const next = prev.then(fn, fn);

  const tail = next
    .catch(() => {})
    .finally(() => {
      if (locks.get(absPath) === tail) locks.delete(absPath);
    });
  locks.set(absPath, tail);
  return next;
}

export function withFileLocks<T>(paths: string[], fn: () => Promise<T>): Promise<T> {
  const sorted = [...new Set(paths)].sort();
  return sorted.reduceRight<() => Promise<T>>((acc, p) => () => withFileLock(p, acc), fn)();
}

function tempPath(target: string): string {
  const dir = path.dirname(target);
  return path.join(dir, `.clarvis-tmp-${uniqueToken()}`);
}

async function stage(target: string, content: string): Promise<string> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = tempPath(target);
  const fh = await fs.open(tmp, "wx");
  try {
    await fh.writeFile(content, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  return tmp;
}

async function captureMode(target: string): Promise<number | undefined> {
  try {
    return (await fs.stat(target)).mode & 0o777;
  } catch {
    return undefined;
  }
}

async function assertNotSymlink(target: string): Promise<void> {
  const lst = await fs.lstat(target).catch(() => null);
  if (lst?.isSymbolicLink()) {
    throw new ToolError("invalid_input", `Refusing to write through a symlink: ${target}`, {
      path: target,
    });
  }
}

async function fsyncDir(dir: string): Promise<void> {
  let dh;
  try {
    dh = await fs.open(dir, "r");
  } catch {
    return;
  }
  try {
    await dh.sync();
  } catch {
    return;
  } finally {
    await dh.close();
  }
}

export async function writeAtomic(target: string, content: string): Promise<void> {
  await assertNotSymlink(target);
  const tmp = await stage(target, content);
  try {
    const mode = await captureMode(target);
    if (mode !== undefined) await fs.chmod(tmp, mode);
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  await fsyncDir(path.dirname(target));
}

export interface FileOp {
  type: "create" | "modify" | "delete" | "rename";
  path: string;
  from?: string;
  content?: string;
}

interface Committed {
  op: FileOp;
  backup: string | undefined;
  fromBackup?: string;
  renamed?: boolean;
}

async function cleanupStaged(staged: Map<string, string>): Promise<void> {
  for (const tmp of staged.values()) await fs.rm(tmp, { force: true }).catch(() => {});
}

async function stageAll(ops: FileOp[]): Promise<Map<string, string>> {
  const staged = new Map<string, string>();
  try {
    for (const op of ops) {
      if (op.type === "create" || op.type === "modify") {
        staged.set(op.path, await stage(op.path, op.content ?? ""));
      } else if (op.type === "rename") {
        if (op.content !== undefined) {
          staged.set(op.path, await stage(op.path, op.content));
        } else {
          await fs.mkdir(path.dirname(op.path), { recursive: true });
        }
      }
    }
  } catch (err) {
    await cleanupStaged(staged);
    throw err;
  }
  return staged;
}

async function validateTargets(ops: FileOp[]): Promise<Map<string, number | undefined>> {
  const modes = new Map<string, number | undefined>();
  for (const op of ops) {
    if (op.type === "rename") {
      const from = op.from!;
      const to = op.path;
      await assertNotSymlink(from);
      await assertNotSymlink(to);
      let stFrom;
      try {
        stFrom = await fs.stat(from);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new ToolError("not_found", `Rename source does not exist: ${from}`, { path: from });
        }
        throw err;
      }
      if (stFrom.isDirectory()) {
        throw new ToolError("not_a_file", `Rename source is a directory: ${from}`, { path: from });
      }
      let toExists = true;
      try {
        await fs.stat(to);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") toExists = false;
        else throw err;
      }
      if (toExists) {
        throw new ToolError("invalid_input", `Rename destination already exists: ${to}`, {
          path: to,
        });
      }
      modes.set(to, stFrom.mode & 0o777);
      continue;
    }
    await assertNotSymlink(op.path);
    let st;
    try {
      st = await fs.stat(op.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      modes.set(op.path, undefined);
      continue;
    }
    if (st.isDirectory()) {
      throw new ToolError("not_a_file", `Path is a directory: ${op.path}`, { path: op.path });
    }
    modes.set(op.path, st.mode & 0o777);
  }
  return modes;
}

async function commitWithRollback(
  ops: FileOp[],
  staged: Map<string, string>,
  modes: Map<string, number | undefined>,
): Promise<Committed[]> {
  const committed: Committed[] = [];
  try {
    for (const op of ops) {
      if (op.type === "rename") {
        const from = op.from!;
        const to = op.path;
        const mode = modes.get(to);
        const rec: Committed = { op, backup: undefined };
        committed.push(rec);
        const tmp = staged.get(to);
        if (tmp !== undefined) {
          const fromBkp = tempPath(from);
          await fs.rename(from, fromBkp);
          rec.fromBackup = fromBkp;
          if (mode !== undefined) await fs.chmod(tmp, mode);
          await fs.rename(tmp, to);
        } else {
          await fs.rename(from, to);
          rec.renamed = true;
        }
        continue;
      }
      const mode = modes.get(op.path);
      let backup: string | undefined;
      const bkp = tempPath(op.path);
      try {
        await fs.rename(op.path, bkp);
        backup = bkp;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        backup = undefined;
      }
      committed.push({ op, backup });
      if (op.type !== "delete") {
        const tmp = staged.get(op.path);
        if (tmp === undefined) throw new Error(`internal: no staged content for ${op.path}`);
        if (mode !== undefined) await fs.chmod(tmp, mode);
        await fs.rename(tmp, op.path);
      }
    }
  } catch (err) {
    const unrestored: string[] = [];
    for (let i = committed.length - 1; i >= 0; i--) {
      const rec = committed[i]!;
      const { op, backup } = rec;
      try {
        if (op.type === "rename") {
          const from = op.from!;
          const to = op.path;
          if (rec.fromBackup !== undefined) {
            await fs.rm(to, { force: true });
            await fs.rename(rec.fromBackup, from);
          } else if (rec.renamed) {
            await fs.rename(to, from);
          }
          continue;
        }
        if (op.type !== "delete") await fs.rm(op.path, { force: true });
        if (backup !== undefined) await fs.rename(backup, op.path);
      } catch {
        if (op.type === "rename" && rec.renamed && rec.fromBackup === undefined) {
          unrestored.push(`${op.from} (original content preserved at ${op.path})`);
        } else {
          unrestored.push(
            `${op.type === "rename" ? op.from : op.path} ` +
              "(original content preserved in an adjacent .clarvis-tmp-* backup)",
          );
        }
      }
    }
    await cleanupStaged(staged);
    if (unrestored.length > 0) {
      throw new ToolError(
        "io_error",
        `${(err as Error).message}; rollback could not restore ${unrestored.join(", ")}`,
      );
    }
    throw err;
  }
  return committed;
}

export async function applyOpsAtomic(ops: FileOp[]): Promise<void> {
  const staged = await stageAll(ops);

  let modes: Map<string, number | undefined>;
  try {
    modes = await validateTargets(ops);
  } catch (err) {
    await cleanupStaged(staged);
    throw err;
  }

  const committed = await commitWithRollback(ops, staged, modes);

  const dirs = new Set<string>();
  for (const op of ops) {
    dirs.add(path.dirname(op.path));
    if (op.type === "rename" && op.from !== undefined) dirs.add(path.dirname(op.from));
  }
  for (const dir of dirs) {
    await fsyncDir(dir);
  }

  for (const { backup, fromBackup } of committed) {
    if (backup !== undefined) await fs.rm(backup, { force: true }).catch(() => {});
    if (fromBackup !== undefined) await fs.rm(fromBackup, { force: true }).catch(() => {});
  }
}
