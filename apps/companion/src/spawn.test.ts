import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { npmShimEntry, planSpawn, quoteArgv, resolveExecutable, spawnResolved } from "./spawn.js";

const isWin = process.platform === "win32";
const tricky = ["plain", "with space", 'quote"inside', "trailing\\", "a&b|c", "100%", "(paren)", "^caret", ""];

function collect(child: ReturnType<typeof spawnResolved>): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", reject);
    child.on("exit", () => resolve(out));
  });
}

describe("argument quoting", () => {
  it("follows CommandLineToArgvW rules", () => {
    expect(quoteArgv("plain")).toBe("plain");
    expect(quoteArgv("a b")).toBe('"a b"');
    expect(quoteArgv('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteArgv("dir\\ x\\")).toBe('"dir\\ x\\\\"');
    expect(quoteArgv("")).toBe('""');
  });

  it("plans .cmd shims through cmd.exe and .exe directly", () => {
    const cmd = planSpawn({ file: "D:\\tools\\codex.cmd", kind: "cmd" }, ["app-server"], { ComSpec: "cmd.exe" });
    expect(cmd.file).toBe("cmd.exe");
    expect(cmd.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(cmd.options.windowsVerbatimArguments).toBe(true);
    const exe = planSpawn({ file: "D:\\tools\\codex.exe", kind: "exe" }, ["app-server"]);
    expect(exe).toMatchObject({ file: "D:\\tools\\codex.exe", args: ["app-server"] });
    const node = planSpawn({ file: "D:\\n\\node.exe", kind: "exe", prefixArgs: ["D:\\n\\codex.js"] }, ["app-server"]);
    expect(node.args).toEqual(["D:\\n\\codex.js", "app-server"]);
  });

  it("maps an npm shim to node + codex.js", () => {
    const dir = mkdtempSync(join(tmpdir(), "sulti-npm-"));
    mkdirSync(join(dir, "node_modules", "@openai", "codex", "bin"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "@openai", "codex", "bin", "codex.js"), "");
    expect(npmShimEntry(join(dir, "codex.cmd"), "D:\\node.exe")).toEqual({
      file: "D:\\node.exe",
      kind: "exe",
      prefixArgs: [join(dir, "node_modules", "@openai", "codex", "bin", "codex.js")],
    });
    expect(npmShimEntry(join(tmpdir(), "nowhere", "codex.cmd"))).toBeNull();
  });
});

describe.skipIf(!isWin)("spawning on Windows", () => {
  // With "node -e", user arguments start at argv[1].
  const script = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";

  it("spawns a native .exe with arguments intact", async () => {
    const out = await collect(spawnResolved({ file: process.execPath, kind: "exe" }, ["-e", script, ...tricky]));
    expect(JSON.parse(out)).toEqual(tricky);
  });

  it("spawns a .cmd shim with arguments intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sulti shim "));
    const shim = join(dir, "fake-codex.cmd");
    // Same shape as an npm shim: forwards all arguments to node.
    writeFileSync(shim, `@echo off\r\n"${process.execPath}" -e "${script}" %*\r\n`);
    const out = await collect(spawnResolved({ file: shim, kind: "cmd" }, tricky));
    expect(JSON.parse(out)).toEqual(tricky);
  });

  it("prefers codex.exe over codex.cmd on PATH", () => {
    const a = mkdtempSync(join(tmpdir(), "sulti-path-a-"));
    const b = mkdtempSync(join(tmpdir(), "sulti-path-b-"));
    writeFileSync(join(a, "fakecodex.cmd"), "@echo off\r\n");
    writeFileSync(join(b, "fakecodex.exe"), "");
    expect(resolveExecutable("fakecodex", { Path: `${a};${b}` }, "win32")).toEqual({ file: join(b, "fakecodex.exe"), kind: "exe" });
    expect(resolveExecutable("fakecodex", { Path: a }, "win32")).toEqual({ file: join(a, "fakecodex.cmd"), kind: "cmd" });
    expect(resolveExecutable("nope-not-here", { Path: a }, "win32")).toBeNull();
  });

  it("node itself refuses .cmd without a shell (why this module exists)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sulti-einval-"));
    const shim = join(dir, "x.cmd");
    writeFileSync(shim, "@echo off\r\necho hi\r\n");
    expect(() => execFileSync(shim, [])).toThrow();
  });
});
