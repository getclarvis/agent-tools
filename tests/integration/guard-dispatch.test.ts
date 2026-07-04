import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWorkspace, cleanup, makeConfig, callTool, exists } from "../helpers/fixtures.js";
import { touchesOutside } from "../../src/guard/index.js";
import type { Guard, Elicit } from "../../src/guard/types.js";

let root: string;
beforeEach(() => {
  root = makeWorkspace();
});
afterEach(() => cleanup(root));

const writeArgs = { path: "f.txt", content: "hi" };

describe("dispatch guard hook", () => {
  it("runs the tool unchanged when no guard is configured", async () => {
    const r = await callTool("write_file", writeArgs, makeConfig(root));
    expect(r.isError).toBe(false);
    expect(exists(root, "f.txt")).toBe(true);
  });

  it("allows the call when the guard returns allow", async () => {
    const guard: Guard = () => ({ verdict: "allow" });
    const r = await callTool("write_file", writeArgs, makeConfig(root, { guard }));
    expect(r.isError).toBe(false);
    expect(exists(root, "f.txt")).toBe(true);
  });

  it("denies the call and never runs the handler", async () => {
    const guard: Guard = () => ({ verdict: "deny", reason: "nope" });
    const r = await callTool("write_file", writeArgs, makeConfig(root, { guard }));
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("denied");
    expect(r.json.message).toBe("nope");
    expect(exists(root, "f.txt")).toBe(false);
  });

  it("denies an ask when no elicit handler is configured", async () => {
    const guard: Guard = () => ({ verdict: "ask" });
    const r = await callTool("write_file", writeArgs, makeConfig(root, { guard }));
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("denied");
    expect(exists(root, "f.txt")).toBe(false);
  });

  it("resolves an ask through the elicit handler", async () => {
    const guard: Guard = () => ({ verdict: "ask", reason: "confirm" });

    const yes = vi.fn<Elicit>(() => true);
    const rYes = await callTool("write_file", writeArgs, makeConfig(root, { guard, elicit: yes }));
    expect(rYes.isError).toBe(false);
    expect(exists(root, "f.txt")).toBe(true);
    expect(yes).toHaveBeenCalledOnce();
    expect(yes.mock.calls[0]?.[0]).toMatchObject({ tool: "write_file", reason: "confirm" });

    cleanup(root);
    root = makeWorkspace();
    const no: Elicit = () => false;
    const rNo = await callTool("write_file", writeArgs, makeConfig(root, { guard, elicit: no }));
    expect(rNo.isError).toBe(true);
    expect(rNo.json.error).toBe("denied");
    expect(exists(root, "f.txt")).toBe(false);
  });

  it("fails closed when the guard throws", async () => {
    const guard: Guard = () => {
      throw new Error("boom");
    };
    const r = await callTool("write_file", writeArgs, makeConfig(root, { guard }));
    expect(r.isError).toBe(true);
    expect(exists(root, "f.txt")).toBe(false);
  });

  it("composes with helpers: deny bash that escapes, allow one that does not", async () => {
    const guard: Guard = (ctx) =>
      touchesOutside(ctx) ? { verdict: "deny" } : { verdict: "allow" };
    const config = makeConfig(root, { guard });

    const denied = await callTool("bash", { command: "cat /etc/passwd" }, config);
    expect(denied.isError).toBe(true);
    expect(denied.json.error).toBe("denied");

    const allowed = await callTool("bash", { command: "echo hi" }, config);
    expect(allowed.isError).toBe(false);
    expect(allowed.json.stdout).toBe("hi\n");
  });
});
