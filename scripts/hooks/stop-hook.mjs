#!/usr/bin/env node
// Sulti Stop hook: a pure observer. Reads Codex's Stop payload (stdin JSON,
// or the legacy notify JSON passed as the last argv argument), and POSTs the
// final answer to the local Sulti companion at 127.0.0.1:7418.
//
// It never prints anything and always exits 0, because Stop-hook output can
// make Codex continue the turn. Errors go to %APPDATA%\sulti\hook-errors.log
// as one line without any message content.
//
//   node stop-hook.mjs            normal use (configured by install-hook.ps1)
//   node stop-hook.mjs --debug    also save the raw payload into the data dir
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TIMEOUT_MS = 1500;

export function dataDir(env = process.env) {
  if (env.SULTI_DATA_DIR) return env.SULTI_DATA_DIR;
  if (env.APPDATA) return join(env.APPDATA, "sulti");
  return join(homedir(), ".sulti");
}

/** Normalize a Stop-hook or legacy notify payload. Returns null if it isn't one. */
export function extractStop(payload) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload;
  const event = p.hook_event_name ?? p.type ?? null;
  if (event !== null && event !== "Stop" && event !== "agent-turn-complete") return null;
  const cwd = typeof p.cwd === "string" ? p.cwd : null;
  if (!cwd) return null;
  const msg = p.last_assistant_message ?? p["last-assistant-message"] ?? null;
  return {
    event: event ?? "Stop",
    cwd,
    sessionId: p.session_id ?? p["thread-id"] ?? p.thread_id ?? null,
    turnId: p.turn_id ?? p["turn-id"] ?? null,
    lastAssistantMessage: typeof msg === "string" ? msg : null,
  };
}

/** Parse the raw stdin text, falling back to the last argv argument (notify). */
export function parseInput(stdinText, argv) {
  const candidates = [stdinText, argv.filter((a) => !a.startsWith("--")).at(-1)];
  for (const c of candidates) {
    if (typeof c !== "string" || !c.trim()) continue;
    try {
      return JSON.parse(c);
    } catch {
      // try the next source
    }
  }
  return null;
}

function readStdin(timeoutMs = 1000) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let buf = "";
    const done = () => resolve(buf);
    const t = setTimeout(done, timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => {
      clearTimeout(t);
      done();
    });
    process.stdin.on("error", () => {
      clearTimeout(t);
      done();
    });
  });
}

function logError(dir, what) {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "hook-errors.log"), `${new Date().toISOString()} ${what}\n`);
  } catch {
    // nothing else we can do quietly
  }
}

function hookSecret(dir, env = process.env) {
  if (env.SULTI_HOOK_SECRET) return env.SULTI_HOOK_SECRET;
  return JSON.parse(readFileSync(join(dir, "secrets.json"), "utf8")).hookSecret;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const dir = dataDir(env);
  try {
    const raw = await readStdin();
    const payload = parseInput(raw, argv);
    if (argv.includes("--debug")) {
      // Debug captures go to the data dir, never the repo. They contain the answer text.
      mkdirSync(join(dir, "hook-debug"), { recursive: true });
      writeFileSync(join(dir, "hook-debug", `stop-${Date.now()}.json`), JSON.stringify({ stdin: raw, argv, payload }, null, 2));
    }
    const body = extractStop(payload);
    if (!body || !body.lastAssistantMessage) return;
    const port = Number(env.SULTI_HOOK_PORT) || 7418;
    const res = await fetch(`http://127.0.0.1:${port}/hook/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sulti-Hook-Secret": hookSecret(dir, env) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) logError(dir, `companion answered HTTP ${res.status}`);
  } catch (err) {
    logError(dir, `${err?.name ?? "Error"}: ${String(err?.cause?.code ?? err?.code ?? "failed")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().finally(() => process.exit(0));
}
