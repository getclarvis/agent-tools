import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, cleanup, makeConfig, callTool, write } from "../helpers/fixtures.js";
import type { ServerConfig } from "../../src/config.js";

describe("outline", () => {
  let root: string;
  let config: ServerConfig;

  beforeEach(() => {
    root = makeWorkspace();
    config = makeConfig(root, { treeSitterAvailable: true });
  });
  afterEach(() => cleanup(root));

  it("outlines a TypeScript file with nesting, ranges, and a header line", async () => {
    write(
      root,
      "src/server.ts",
      [
        "export abstract class Server {",
        "  private port: number;",
        "  constructor(port: number) { this.port = port; }",
        "  abstract handle(req: string): string;",
        "  async start(): Promise<void> {",
        "  }",
        "}",
        "export interface Options { verbose?: boolean }",
        "export type Handler = () => void;",
        "export enum Level { Low, High }",
        "export function createServer(): Server { return null!; }",
        "export const parse = (s: string): number => Number(s);",
        "namespace Util { export function inner(): void {} }",
        "",
      ].join("\n"),
    );
    const r = await callTool("outline", { path: "src/server.ts" }, config);
    expect(r.isError).toBe(false);
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("src/server.ts — typescript, 14 lines");
    expect(r.text).toContain("  abstract class Server (1-7)");
    expect(r.text).toContain("    private port: number (2-2)");
    expect(r.text).toContain("    constructor(port: number) { this.port = port; } (3-3)");
    expect(r.text).toContain("    abstract handle(req: string): string (4-4)");
    expect(r.text).toContain("    async start(): Promise<void> (5-6)");
    expect(r.text).toContain("  interface Options { verbose?: boolean } (8-8)");
    expect(r.text).toContain("  type Handler = () => void; (9-9)");
    expect(r.text).toContain("  enum Level { Low, High } (10-10)");
    expect(r.text).toContain("  function createServer(): Server { return null!; } (11-11)");
    expect(r.text).toContain("  const parse = (s: string): number => Number(s); (12-12)");
    expect(r.text).toContain("  namespace Util { export function inner(): void {} } (13-13)");
    expect(r.text).toContain("    function inner(): void {} (13-13)");
    expect(r.text).not.toContain("note:");
  });

  it("outlines tsx components without routing through the typescript grammar", async () => {
    write(
      root,
      "App.tsx",
      "export function App() {\n  return <div />;\n}\nexport const W = () => <span />;\n",
    );
    const r = await callTool("outline", { path: "App.tsx" }, config);
    expect(r.text).toContain("App.tsx — tsx, 5 lines");
    expect(r.text).toContain("  function App() (1-3)");
    expect(r.text).toContain("  const W = () => <span />; (4-4)");
  });

  it("outlines JavaScript including generators and function-valued variables", async () => {
    write(
      root,
      "a.js",
      [
        "class Cache {",
        "  get(k) { return k; }",
        "}",
        "function main() {}",
        "const handler = async (e) => e;",
        "var legacy = function () {};",
        "function* gen() { yield 1; }",
        "const notAFunction = 42;",
        "",
      ].join("\n"),
    );
    const r = await callTool("outline", { path: "a.js" }, config);
    expect(r.text).toContain("  class Cache (1-3)");
    expect(r.text).toContain("    get(k) { return k; } (2-2)");
    expect(r.text).toContain("  function main() {} (4-4)");
    expect(r.text).toContain("  const handler = async (e) => e; (5-5)");
    expect(r.text).toContain("  var legacy = function () {}; (6-6)");
    expect(r.text).toContain("  function* gen() { yield 1; } (7-7)");
    expect(r.text).not.toContain("notAFunction");
  });

  it("outlines Python with decorators, nesting, and async defs", async () => {
    write(
      root,
      "m.py",
      [
        "class Repo:",
        "    def __init__(self, path):",
        "        self.path = path",
        "",
        "    @property",
        "    def name(self):",
        "        return self.path",
        "",
        "@decorator",
        "def decorated(x):",
        "    def nested(y):",
        "        return y",
        "    return nested",
        "",
        "async def fetch(url):",
        "    pass",
        "",
      ].join("\n"),
    );
    const r = await callTool("outline", { path: "m.py" }, config);
    expect(r.text).toContain("  class Repo (1-7)");
    expect(r.text).toContain("    def __init__(self, path) (2-3)");
    expect(r.text).toContain("    def name(self) (6-7)");
    expect(r.text).toContain("  def decorated(x) (10-13)");
    expect(r.text).toContain("    def nested(y) (11-12)");
    expect(r.text).toContain("  async def fetch(url) (15-16)");
  });

  it("outlines Go types, functions, and methods", async () => {
    write(
      root,
      "s.go",
      [
        "package main",
        "",
        "type Server struct {",
        "\tport int",
        "}",
        "",
        "type Handler interface {",
        "\tHandle() error",
        "}",
        "",
        "func NewServer() *Server {",
        "\treturn nil",
        "}",
        "",
        "func (s *Server) Start() error {",
        "\treturn nil",
        "}",
        "",
      ].join("\n"),
    );
    const r = await callTool("outline", { path: "s.go" }, config);
    expect(r.text).toContain("  Server struct (3-5)");
    expect(r.text).toContain("  Handler interface (7-9)");
    expect(r.text).toContain("  func NewServer() *Server (11-13)");
    expect(r.text).toContain("  func (s *Server) Start() error (15-17)");
  });

  it("outlines Rust items including impl blocks and macros", async () => {
    write(
      root,
      "lib.rs",
      [
        "pub mod util {",
        "    pub fn helper() -> i32 { 1 }",
        "}",
        "pub struct Server { port: u16 }",
        "pub enum Level { Low, High }",
        "pub trait Handle {",
        "    fn handle(&self) -> String;",
        "}",
        "impl Handle for Server {",
        "    fn handle(&self) -> String { String::new() }",
        "}",
        "macro_rules! my_macro {",
        "    () => {};",
        "}",
        "pub fn main() {}",
        "",
      ].join("\n"),
    );
    const r = await callTool("outline", { path: "lib.rs" }, config);
    expect(r.text).toContain("  pub mod util (1-3)");
    expect(r.text).toContain("    pub fn helper() -> i32 { 1 } (2-2)");
    expect(r.text).toContain("  pub struct Server { port: u16 } (4-4)");
    expect(r.text).toContain("  pub enum Level { Low, High } (5-5)");
    expect(r.text).toContain("  pub trait Handle (6-8)");
    expect(r.text).toContain("  impl Handle for Server (9-11)");
    expect(r.text).toContain("    fn handle(&self) -> String { String::new() } (10-10)");
    expect(r.text).toContain("  macro_rules! my_macro (12-14)");
    expect(r.text).toContain("  pub fn main() {} (15-15)");
  });

  it("outlines Java classes, constructors, records, and nested types", async () => {
    write(
      root,
      "Server.java",
      [
        "public class Server {",
        "    private int port;",
        "    public Server(int port) { this.port = port; }",
        "    public void start() {}",
        "    interface Callback { void done(); }",
        "    enum Level { LOW, HIGH }",
        "}",
        "record Point(int x, int y) {}",
        "",
      ].join("\n"),
    );
    const r = await callTool("outline", { path: "Server.java" }, config);
    expect(r.text).toContain("  public class Server (1-7)");
    expect(r.text).toContain("    public Server(int port) { this.port = port; } (3-3)");
    expect(r.text).toContain("    public void start() {} (4-4)");
    expect(r.text).toContain("    interface Callback { void done(); } (5-5)");
    expect(r.text).toContain("    enum Level { LOW, HIGH } (6-6)");
    expect(r.text).toContain("  record Point(int x, int y) {} (8-8)");
  });

  it("outlines C# namespaces, properties, and records", async () => {
    write(
      root,
      "Server.cs",
      [
        "namespace Example;",
        "",
        "public class Server",
        "{",
        "    public Server(int port) { Port = port; }",
        "    public int Port { get; set; }",
        "    public void Start() {}",
        "}",
        "",
        "public interface IHandler",
        "{",
        "    void Handle();",
        "}",
        "",
        "public struct Point { public int X; }",
        "",
        "public enum Level { Low, High }",
        "",
        "public record User(string Name);",
        "",
      ].join("\n"),
    );
    const r = await callTool("outline", { path: "Server.cs" }, config);
    expect(r.text).toContain("  namespace Example; (1-1)");
    expect(r.text).toContain("  public class Server (3-8)");
    expect(r.text).toContain("    public Server(int port) { Port = port; } (5-5)");
    expect(r.text).toContain("    public int Port { get; set; } (6-6)");
    expect(r.text).toContain("    public void Start() {} (7-7)");
    expect(r.text).toContain("  public interface IHandler (10-13)");
    expect(r.text).toContain("  public struct Point { public int X; } (15-15)");
    expect(r.text).toContain("  public enum Level { Low, High } (17-17)");
    expect(r.text).toContain("  public record User(string Name); (19-19)");
  });

  it("reports (no symbols found) for a file without declarations", async () => {
    write(root, "empty.ts", "// nothing here\n");
    const r = await callTool("outline", { path: "empty.ts" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("(no symbols found)");
  });

  it("appends a syntax-error note for a broken file", async () => {
    write(root, "broken.ts", "export class Ok {}\nconst x = = 1;\n");
    const r = await callTool("outline", { path: "broken.ts" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("  class Ok {} (1-1)");
    expect(r.text).toMatch(/note: file has syntax errors \(\d+\+?\); outline may be incomplete/);
  });

  it("rejects a grammar without outline support, pointing at check_syntax", async () => {
    write(root, "a.rb", "class Foo\nend\n");
    const r = await callTool("outline", { path: "a.rb" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("invalid_input");
    expect(r.json.message).toContain("ruby");
    expect(r.json.message).toContain("check_syntax does support");
  });

  it("rejects an unsupported extension with invalid_input", async () => {
    write(root, "notes.txt", "hello\n");
    const r = await callTool("outline", { path: "notes.txt" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("invalid_input");
    expect(r.json.message).toContain("'.txt'");
  });

  it("returns not_found for a missing file", async () => {
    const r = await callTool("outline", { path: "nope.py" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("not_found");
  });

  it("caps entries and reports how many symbols were omitted", async () => {
    const defs = Array.from({ length: 2005 }, (_, i) => `def f${i}():\n    pass\n`).join("");
    write(root, "many.py", defs);
    const r = await callTool("outline", { path: "many.py" }, config);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("def f0() (1-2)");
    expect(r.text).toContain("[... 5 more symbols omitted ...]");
    expect(r.text).not.toContain("def f2004()");
  });

  it("rejects a file over the parse limit with too_large", async () => {
    write(root, "big.py", `x = "${"a".repeat(2_000_001)}"\n`);
    const r = await callTool("outline", { path: "big.py" }, config);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("too_large");
  });

  it("maps an aborted signal to the aborted error code", async () => {
    write(root, "a.py", "x = 1\n");
    const ac = new AbortController();
    ac.abort();
    const r = await callTool("outline", { path: "a.py" }, config, ac.signal);
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("aborted");
  });

  it("maps a broken runtime to an internal error", async () => {
    const { _resetTreeSitterForTests } = await import("../../src/lib/treesitter.js");
    const { setWarnSink } = await import("../../src/lib/log.js");
    setWarnSink(() => {});
    _resetTreeSitterForTests(() => {
      throw new Error("boom");
    });
    try {
      write(root, "a.py", "x = 1\n");
      const r = await callTool("outline", { path: "a.py" }, config);
      expect(r.isError).toBe(true);
      expect(r.json.error).toBe("internal");
    } finally {
      _resetTreeSitterForTests();
      setWarnSink(null);
    }
  });
});
