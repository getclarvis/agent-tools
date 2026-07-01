import { promises as fs } from "node:fs";
import { applyPatch, parsePatch, type StructuredPatch } from "diff";
import { ToolError, fsError } from "../errors.js";
import { resolvePath, displayPath } from "../lib/paths.js";
import { applyOpsAtomic, withFileLocks, type FileOp } from "../lib/atomic.js";
import { encodeText, reencode, type Eol, type DecodedText } from "../lib/text.js";
import { readTextFile } from "../lib/textfile.js";
import type { ToolDef } from "./types.js";

function cleanName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (name === "/dev/null") return "/dev/null";

  const noTab = name.split("\t")[0] ?? name;
  return noTab.replace(/^[ab]\//, "");
}

async function readEditableFile(
  target: string,
  rel: string,
  maxBytes: number,
): Promise<DecodedText> {
  const decoded = await readTextFile(target, rel, maxBytes);
  if (decoded.encoding !== "utf8") {
    throw new ToolError(
      "is_binary",
      `Patching ${decoded.encoding} files is not supported (the file would be rewritten as ` +
        `UTF-8): ${rel}`,
      { path: rel, encoding: decoded.encoding },
    );
  }
  return decoded;
}

function countChanges(p: StructuredPatch): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const h of p.hunks) {
    for (const line of h.lines) {
      if (line.startsWith("+")) adds++;
      else if (line.startsWith("-")) dels++;
    }
  }
  return { adds, dels };
}

function firstFailingHunk(source: string, p: StructuredPatch): number | undefined {
  let cur = source;
  for (let i = 0; i < p.hunks.length; i++) {
    const hunk = p.hunks[i];
    if (hunk === undefined) continue;
    const single: StructuredPatch = { ...p, hunks: [hunk] };
    const r = applyPatch(cur, single);
    if (r === false) return i + 1;
    cur = r;
  }
  return undefined;
}

export const applyPatchTool: ToolDef = {
  name: "apply_patch",
  description:
    "Apply a unified diff across one or more files in a single atomic call (modify, create via " +
    "`--- /dev/null`, delete via `+++ /dev/null`, rename/move when the old and new paths differ). " +
    "Hunks are located by their context lines with a small line-offset tolerance; a hunk whose " +
    "context does not match fails (`patch_failed`, naming the file and hunk) and NOTHING is " +
    "written. Use for changes spanning MANY files; for several edits to a single file use " +
    "multi_edit.",
  inputSchema: {
    type: "object",
    properties: {
      patch: {
        type: "string",
        description:
          "A unified diff with --- / +++ file headers and @@ hunks. File paths come from the " +
          "headers (a/ and b/ prefixes are stripped) and resolve like any path; a block whose old " +
          "and new paths differ renames/moves the file. Hunk bodies use LF line endings.",
      },
    },
    required: ["patch"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const patchText = args.patch as string;

    let parsed: StructuredPatch[];
    try {
      parsed = parsePatch(patchText);
    } catch (err) {
      throw new ToolError("invalid_input", `Malformed patch: ${(err as Error).message}`);
    }

    if (parsed.length === 0) {
      throw new ToolError("invalid_input", "Patch contains no applicable hunks");
    }
    const actionable = parsed.some((p) => {
      if (p.hunks.length > 0) return true;
      const o = cleanName(p.oldFileName);
      const n = cleanName(p.newFileName);
      return !!o && !!n && o !== "/dev/null" && n !== "/dev/null" && o !== n;
    });
    if (!actionable) {
      throw new ToolError("invalid_input", "Patch contains no applicable hunks");
    }

    const lockTargets: string[] = [];
    for (const p of parsed) {
      for (const name of [cleanName(p.oldFileName), cleanName(p.newFileName)]) {
        if (name && name !== "/dev/null")
          lockTargets.push(resolvePath(name, config.workspaceRoot, config.confineToWorkspace));
      }
    }

    return withFileLocks(lockTargets, () => applyParsed(parsed, config));
  },
};

async function applyParsed(
  parsed: StructuredPatch[],
  config: { workspaceRoot: string; maxFileBytes: number; confineToWorkspace: boolean },
): Promise<string> {
  const ops: FileOp[] = [];
  const summary: string[] = [];
  const seen = new Set<string>();

  const claim = (abs: string, rel: string): void => {
    if (seen.has(abs)) {
      throw new ToolError(
        "invalid_input",
        `Patch contains multiple blocks for ${rel}; combine them into a single block.`,
        { path: rel },
      );
    }
    seen.add(abs);
  };

  for (const p of parsed) {
    const oldName = cleanName(p.oldFileName);
    const newName = cleanName(p.newFileName);
    const isCreate = oldName === "/dev/null";
    const isDelete = newName === "/dev/null";
    const isRename = !isCreate && !isDelete && !!oldName && !!newName && oldName !== newName;

    if (isRename) {
      const absFrom = resolvePath(oldName, config.workspaceRoot, config.confineToWorkspace);
      const absTo = resolvePath(newName, config.workspaceRoot, config.confineToWorkspace);
      if (absFrom !== absTo) {
        const relFrom = displayPath(absFrom, config.workspaceRoot);
        const relTo = displayPath(absTo, config.workspaceRoot);
        claim(absFrom, relFrom);
        claim(absTo, relTo);

        const decoded = await readEditableFile(absFrom, relFrom, config.maxFileBytes);
        const result = applyPatch(decoded.content, p);
        if (result === false) {
          const hunk = firstFailingHunk(decoded.content, p);
          throw new ToolError("patch_failed", `Hunk did not apply cleanly in ${relFrom}`, {
            file: relFrom,
            ...(hunk !== undefined ? { hunk } : {}),
          });
        }

        const { adds, dels } = countChanges(p);
        if (p.hunks.length === 0 || result === decoded.content) {
          ops.push({ type: "rename", path: absTo, from: absFrom });
          summary.push(`  R ${relFrom} -> ${relTo}`);
        } else {
          ops.push({
            type: "rename",
            path: absTo,
            from: absFrom,
            content: reencode(result, decoded),
          });
          summary.push(`  R ${relFrom} -> ${relTo} (+${adds} -${dels})`);
        }
        continue;
      }
    }

    const relTarget = (isCreate ? newName : oldName) as string;
    if (!relTarget || relTarget === "/dev/null") {
      throw new ToolError("invalid_input", "Patch is missing a valid file path");
    }
    const absTarget = resolvePath(relTarget, config.workspaceRoot, config.confineToWorkspace);
    const rel = displayPath(absTarget, config.workspaceRoot);

    claim(absTarget, rel);

    let source = "";
    let eol: Eol = "lf";
    let bom = false;
    let decoded: DecodedText | null = null;
    if (!isCreate) {
      decoded = await readEditableFile(absTarget, relTarget, config.maxFileBytes);
      source = decoded.content;
      eol = decoded.eol;
      bom = decoded.bom;
    }

    const result = applyPatch(source, p);
    if (result === false) {
      const hunk = firstFailingHunk(source, p);
      throw new ToolError("patch_failed", `Hunk did not apply cleanly in ${rel}`, {
        file: rel,
        ...(hunk !== undefined ? { hunk } : {}),
      });
    }

    const { adds, dels } = countChanges(p);
    if (isDelete) {
      if (result !== "") {
        throw new ToolError(
          "invalid_input",
          `Delete patch for ${rel} does not remove the entire file`,
          { path: rel },
        );
      }
      ops.push({ type: "delete", path: absTarget });
      summary.push(`  D ${rel} (+${adds} -${dels})`);
    } else if (isCreate) {
      let alreadyExists = false;
      try {
        await fs.stat(absTarget);
        alreadyExists = true;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "ENOENT") throw fsError(e, relTarget);
      }
      if (alreadyExists) {
        throw new ToolError(
          "invalid_input",
          `Cannot create ${rel}: a file already exists there. Use a modify hunk with ` +
            "context, or delete it first.",
          { path: rel },
        );
      }
      ops.push({ type: "create", path: absTarget, content: encodeText(result, { eol, bom }) });
      summary.push(`  A ${rel} (+${adds} -${dels})`);
    } else {
      const content = decoded ? reencode(result, decoded) : encodeText(result, { eol, bom });
      ops.push({ type: "modify", path: absTarget, content });
      summary.push(`  M ${rel} (+${adds} -${dels})`);
    }
  }

  try {
    await applyOpsAtomic(ops);
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError("io_error", `Failed to apply patch: ${(err as Error).message}`);
  }

  return `Applied patch:\n${summary.join("\n")}`;
}
