import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, extname, join } from "node:path";

/**
 * Resolving and spawning "codex" on Windows.
 *
 * npm installs codex as a .cmd shim, and Node (since the CVE-2024-27980 fix)
 * refuses to spawn .cmd/.bat files without a shell. Prefer a native
 * codex.exe; for a shim, run it through cmd.exe ourselves with every argument
 * quoted, instead of shell:true string concatenation.
 */
export interface ResolvedCommand {
  file: string;
  kind: "exe" | "cmd" | "other";
  /** Arguments that always come first (e.g. the codex.js entry point). */
  prefixArgs?: string[];
}

/**
 * For an npm shim (codex.cmd), the entry point it runs:
 * <shim dir>/node_modules/@openai/codex/bin/codex.js, and the node.exe next
 * to the shim if there is one. Running node directly behaves like the shim
 * (codex.js sets up PATH for its bundled tools) without going through cmd.exe.
 */
export function npmShimEntry(shim: string, fallbackNode: string = process.execPath): ResolvedCommand | null {
  const dir = dirname(shim);
  const entry = join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
  if (!existsSync(entry)) return null;
  const localNode = join(dir, "node.exe");
  return { file: existsSync(localNode) ? localNode : fallbackNode, kind: "exe", prefixArgs: [entry] };
}

export function resolveExecutable(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): ResolvedCommand | null {
  if (platform !== "win32") {
    for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
      const f = join(dir, name);
      if (existsSync(f)) return { file: f, kind: "other" };
    }
    return null;
  }
  const dirs = (env.Path ?? env.PATH ?? "").split(";").filter(Boolean);
  // 1. A native executable on PATH.
  for (const dir of dirs) {
    const f = join(dir, name + ".exe");
    if (existsSync(f)) return { file: f, kind: "exe" };
  }
  // 2. A .cmd/.bat shim on PATH (npm installs).
  for (const dir of dirs) {
    for (const ext of [".cmd", ".bat"]) {
      const f = join(dir, name + ext);
      if (existsSync(f)) return { file: f, kind: "cmd" };
    }
  }
  // 3. Last resort: the copy bundled with the Codex desktop app, which can lag behind the CLI.
  if (env.LOCALAPPDATA) {
    const f = join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", name + ".exe");
    if (existsSync(f)) return { file: f, kind: "exe" };
  }
  return null;
}

/** Quote one argument for CommandLineToArgvW (the C runtime's parser). */
export function quoteArgv(arg: string): string {
  if (arg !== "" && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      out += "\\".repeat(backslashes * 2 + 1) + '"';
    } else {
      out += "\\".repeat(backslashes) + ch;
    }
    backslashes = 0;
  }
  return out + "\\".repeat(backslashes * 2) + '"';
}

const CMD_META = /[()%!^"<>&|]/g;

/**
 * Escape one argument for "cmd /d /s /c" running a batch file: quote it for
 * CommandLineToArgvW, then caret-escape cmd metacharacters twice, because the
 * batch file re-parses %* after the first cmd pass removes one level.
 */
export function escapeForCmd(arg: string): string {
  return quoteArgv(arg).replace(CMD_META, "^$&").replace(CMD_META, "^$&");
}

export interface SpawnPlan {
  file: string;
  args: string[];
  options: SpawnOptions;
}

/** Build the spawn call for a resolved command. Pure, so it is unit-testable. */
export function planSpawn(cmd: ResolvedCommand, args: readonly string[], env: NodeJS.ProcessEnv = process.env): SpawnPlan {
  const all = [...(cmd.prefixArgs ?? []), ...args];
  if (cmd.kind === "cmd" || extname(cmd.file).toLowerCase() === ".cmd" || extname(cmd.file).toLowerCase() === ".bat") {
    const comspec = env.ComSpec ?? "cmd.exe";
    if (cmd.file.includes('"')) throw new Error("Refusing to run a command path that contains a quote");
    // The batch path goes in plain quotes (spaces are common); arguments are escaped.
    const line = ['"' + cmd.file + '"', ...all.map(escapeForCmd)].join(" ");
    return { file: comspec, args: ["/d", "/s", "/c", `"${line}"`], options: { windowsVerbatimArguments: true, windowsHide: true } };
  }
  return { file: cmd.file, args: all, options: { windowsHide: true } };
}

export function spawnResolved(cmd: ResolvedCommand, args: readonly string[], extra: SpawnOptions = {}): ChildProcessWithoutNullStreams {
  const plan = planSpawn(cmd, args);
  return spawn(plan.file, plan.args, { ...plan.options, ...extra, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
}

/** The codex executable, or an override such as SULTI_CODEX_PATH. */
export function resolveCodex(env: NodeJS.ProcessEnv = process.env): ResolvedCommand {
  if (env.SULTI_CODEX_PATH) {
    const ext = extname(env.SULTI_CODEX_PATH).toLowerCase();
    return { file: env.SULTI_CODEX_PATH, kind: ext === ".exe" ? "exe" : ext === ".cmd" || ext === ".bat" ? "cmd" : "other" };
  }
  const found = resolveExecutable("codex", env);
  if (!found) throw new Error("Could not find codex on PATH. Install the Codex CLI and check `codex --version`.");
  // Prefer running an npm shim's entry point with node directly.
  return found.kind === "cmd" ? (npmShimEntry(found.file) ?? found) : found;
}
