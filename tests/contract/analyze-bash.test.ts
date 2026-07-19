import { describe, expect, it } from "vitest";
import { analyzeBash } from "../../src/guard/analyze-bash.js";

const norm = (command: string): string[] => analyzeBash(command).segments.map((s) => s.normalized);

describe("analyzeBash — undecidable / opaque constructs", () => {
  it("flags command substitution, backticks, encoding-to-shell, eval, env expansion", () => {
    expect(analyzeBash("echo $(whoami)").undecidable).toBe(true);
    expect(analyzeBash("cat `ls`").undecidable).toBe(true);
    expect(analyzeBash("x | base64 -d | sh").undecidable).toBe(true);
    expect(analyzeBash("eval rm").undecidable).toBe(true);
    expect(analyzeBash("rm $HOME/x").undecidable).toBe(true);
    expect(analyzeBash("env FOO=bar ls").undecidable).toBe(true);
    expect(analyzeBash("cat <(echo x)").undecidable).toBe(true);
  });

  it("distinguishes single quotes (safe) from double quotes (expand)", () => {
    expect(analyzeBash("sed -n '/x/,$p'").undecidable).toBe(false);
    expect(analyzeBash("awk '{print $1}' file.txt").undecidable).toBe(false);
    expect(analyzeBash('echo "$HOME"').undecidable).toBe(true);
  });

  it("flags unbalanced quotes / parens and nested substitution", () => {
    expect(analyzeBash("echo 'unterminated").undecidable).toBe(true);
    expect(analyzeBash("echo (").undecidable).toBe(true);
    expect(analyzeBash("echo 'x").undecidable).toBe(true);
    expect(analyzeBash("echo $(echo $(whoami))").undecidable).toBe(true);
  });

  it("does not leak inner paths of an opaque command", () => {
    const a = analyzeBash("echo $(cat /etc/passwd)");
    expect(a.undecidable).toBe(true);
    expect(a.paths).not.toContain("/etc/passwd");
  });
});

describe("analyzeBash — command segmentation", () => {
  it("splits pipelines and and-lists, keeps paths from every segment", () => {
    expect(norm("cat a.txt | grep x")).toEqual(["cat a.txt", "grep x"]);
    const a = analyzeBash("cd src && cat src/a.ts");
    expect(a.segments).toHaveLength(2);
    expect(a.paths).toContain("src/a.ts");
  });

  it("treats redirect ampersands as non-separators, trailing & as a separator", () => {
    expect(norm("echo ok 2>&1 | cat")).toEqual(["echo ok 2>&1", "cat"]);
    const b = analyzeBash("sleep 1 &");
    expect(b.segments.map((s) => s.normalized)).toEqual(["sleep 1"]);
    expect(b.undecidable).toBe(false);
  });

  it("does not split inside quotes or subshells", () => {
    expect(analyzeBash("echo 'a | b'").segments).toHaveLength(1);
    const c = analyzeBash("echo $(a && b)");
    expect(c.segments).toHaveLength(1);
    expect(c.undecidable).toBe(true);
  });

  it("normalizes whitespace", () => {
    expect(norm("ls   -la ")).toEqual(["ls -la"]);
  });
});

describe("analyzeBash — wrapper / env stripping", () => {
  it("strips env assignments and safe wrappers from normalized commands", () => {
    expect(norm("FOO=bar ls -la")).toEqual(["ls -la"]);
    expect(norm("timeout 5 ls -la")).toEqual(["ls -la"]);
    expect(norm("nohup nice node app.js")).toEqual(["node app.js"]);
    expect(norm("timeout -k 5 ls -la")).toEqual(["ls -la"]);
    expect(norm("stdbuf -oL FOO=bar ls")).toEqual(["ls"]);
  });
});

describe("analyzeBash — path extraction", () => {
  it("keeps path-like operands, rejects metachar operands", () => {
    const a = analyzeBash("cat src/a.ts ./b.txt");
    expect(a.undecidable).toBe(false);
    expect(a.paths).toContain("src/a.ts");
    expect(a.paths).toContain("./b.txt");

    const b = analyzeBash("sed -n '/----------/,$p' file.log");
    expect(b.paths).not.toContain("/----------/,$p");
    expect(b.paths).toContain("file.log");

    expect(analyzeBash("cat '/etc/passwd'").paths).toContain("/etc/passwd");
    expect(analyzeBash("cd ..").paths).toContain("..");

    const w = analyzeBash("awk '{print $1}' file.txt");
    expect(w.paths).not.toContain(".");
    expect(w.paths).toContain("file.txt");
  });

  it("reduces globs to their literal directory prefix", () => {
    expect(analyzeBash("cat /etc/pass*").undecidable).toBe(false);
    expect(analyzeBash("cat /etc/pass*").paths).toContain("/etc");
    expect(analyzeBash("cat /etc/{passwd,shadow}").paths).toContain("/etc");
    expect(analyzeBash("cat /etc/passw?").paths).toContain("/etc");
    const g = analyzeBash("cat src/*.ts");
    expect(g.undecidable).toBe(false);
    expect(g.paths).toContain("src");
  });

  it("flags upward-traversing globs and unknown users as undecidable", () => {
    expect(analyzeBash("cat */../../etc/passwd").undecidable).toBe(true);
    expect(analyzeBash("cat ~root/.bashrc").undecidable).toBe(true);
  });

  it("treats literal subshells as transparent for path extraction", () => {
    const s = analyzeBash("(cat /etc/passwd)");
    expect(s.undecidable).toBe(false);
    expect(s.paths).toContain("/etc/passwd");
    expect(analyzeBash("(cd src && cat a.ts)").paths).toContain("a.ts");
  });

  it("keeps ~/ as a decidable path token", () => {
    const a = analyzeBash("cat ~/.ssh/id_rsa");
    expect(a.undecidable).toBe(false);
    expect(a.paths).toContain("~/.ssh/id_rsa");
  });

  it("extracts redirect targets whether glued to the operator or spaced", () => {
    expect(analyzeBash("echo pwned >/etc/cron.d/x").paths).toContain("/etc/cron.d/x");
    expect(analyzeBash("echo pwned >>/etc/cron.d/x").paths).toContain("/etc/cron.d/x");
    expect(analyzeBash("echo hi 2>/tmp/err").paths).toContain("/tmp/err");
    expect(analyzeBash("echo hi &>/tmp/out").paths).toContain("/tmp/out");
    expect(analyzeBash("cat </etc/passwd").paths).toContain("/etc/passwd");
    const spaced = analyzeBash("echo pwned > /etc/cron.d/x");
    expect(spaced.paths).toContain("/etc/cron.d/x");
    expect(spaced.paths).not.toContain(">");
    expect(analyzeBash("echo hi >out.txt").paths).toContain("out.txt");
    expect(analyzeBash("echo hi >&2").paths).not.toContain("&2");
  });
});

describe("analyzeBash — empty input", () => {
  it("returns no segments and is decidable", () => {
    const a = analyzeBash("");
    expect(a.segments).toHaveLength(0);
    expect(a.paths).toHaveLength(0);
    expect(a.undecidable).toBe(false);
  });
});
