/**
 * Speech-to-text bench: local whisper.cpp -> transcript -> Sulti intent router.
 * Reports latency per recording and routing accuracy against utterances.tsv.
 * Downloads nothing; the owner installs whisper.cpp and a model (see README.md).
 *
 *   node tools/stt-bench/bench.ts --whisper <whisper-cli.exe> --model <ggml-*.bin> --dir <folder of WAVs>
 *   node tools/stt-bench/bench.ts --server http://127.0.0.1:8080 --dir <folder of WAVs>
 *   node tools/stt-bench/bench.ts --text-only        # router baseline on the typed utterances
 *
 * Run `npm run build` first (uses the built @sulti/core).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { route, type Intent, type RouteContext } from "@sulti/core";

const here = dirname(fileURLToPath(import.meta.url));

/** Section 9 context: fictional sessions and skills, Sole Harbor active. */
export const BENCH_CONTEXT: RouteContext = {
  sessions: [
    { id: "sole-harbor", name: "Sole Harbor", aliases: ["soul harbor"] },
    { id: "lead-tracker", name: "Lead Tracker", aliases: ["led tracker"] },
    { id: "kernel-labs", name: "Kernel Labs", aliases: ["colonel labs"] },
  ],
  skills: [{ name: "execute-plans" }, { name: "systematic-debugging" }, { name: "writing-tests" }],
  activeSessionId: "sole-harbor",
};

export interface Case {
  file: string;
  expected: string;
  utterance: string;
}

export function parseCases(tsv: string): Case[] {
  return tsv
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const [file = "", expected = "", utterance = ""] = l.split("\t");
      return { file: file.trim(), expected: expected.trim(), utterance: utterance.trim() };
    });
}

/** A short, comparable description of what the router decided. */
export function signature(intent: Intent | null): string {
  if (!intent) return "none";
  let s: string;
  if (intent.kind === "prompt") s = `prompt:${intent.sessionId}`;
  else if (intent.kind === "app") {
    const a = intent.action;
    if (a.type === "switchSession") s = `app:switchSession:${a.sessionId ?? "?"}`;
    else if (a.type === "playback") s = `app:playback:${a.playback}`;
    else if (a.type === "copy") s = `app:copy:${a.target}`;
    else s = "app:showApprovals";
  } else {
    const a = intent.action;
    if (a.type === "skill") s = `codex:skill:${a.skill}`;
    else if (a.type === "goal.update") s = `codex:goal.update:${a.status}`;
    else s = `codex:${a.type}`;
  }
  return intent.needsConfirm ? s + "!" : s;
}

/** Does the router's decision satisfy the expectation? A "!" in the expectation requires needsConfirm. */
export function matches(expected: string, actual: string): boolean {
  if (expected.endsWith("!")) return actual === expected;
  return actual.replace(/!$/, "") === expected;
}

/** Seconds of audio in a PCM WAV file (reads the header; 0 if unknown). */
export function wavSeconds(buf: Buffer): number {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return 0;
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16);
    if (id === "data") return byteRate ? size / byteRate : 0;
    off += 8 + size + (size % 2);
  }
  return 0;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function transcribeCli(whisper: string, model: string, wav: string, threads: string | undefined, prompt: string | undefined): string {
  const args = ["-m", model, "-f", wav, "-l", "en", "-nt", "-np", ...(threads ? ["-t", threads] : []), ...(prompt ? ["--prompt", prompt] : [])];
  const res = spawnSync(whisper, args, { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`whisper exited ${res.status}: ${(res.stderr || "").trim().split("\n").pop() ?? ""}`);
  return res.stdout.replace(/\s+/g, " ").trim();
}

async function transcribeServer(server: string, wav: string, prompt: string | undefined): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(wav)], { type: "audio/wav" }), basename(wav));
  form.append("response_format", "json");
  form.append("language", "en");
  if (prompt) form.append("prompt", prompt);
  const res = await fetch(new URL("/inference", server), { method: "POST", body: form });
  if (!res.ok) throw new Error(`whisper-server ${res.status}`);
  const body = (await res.json()) as { text?: string };
  return (body.text ?? "").replace(/\s+/g, " ").trim();
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

async function main(): Promise<void> {
  const cases = parseCases(readFileSync(arg("cases") ?? join(here, "utterances.tsv"), "utf8"));
  const textOnly = process.argv.includes("--text-only");
  const whisper = arg("whisper");
  const model = arg("model");
  const server = arg("server");
  const dir = arg("dir");
  if (!textOnly) {
    if (!dir) throw new Error("--dir <folder of WAVs> is required (or use --text-only).");
    if (!server && (!whisper || !model)) throw new Error("Pass --whisper <whisper-cli.exe> and --model <ggml model>, or --server <url>.");
    if (server && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(server)) throw new Error("--server must be a loopback URL.");
  }

  const rows: Record<string, unknown>[] = [];
  for (const c of cases) {
    let transcript = c.utterance;
    let latencyMs = 0;
    let audioSec = 0;
    let error: string | undefined;
    if (!textOnly) {
      const wav = resolve(dir!, c.file);
      if (!existsSync(wav)) {
        rows.push({ file: c.file, skipped: "missing WAV" });
        console.log(`SKIP  ${c.file}  (missing)`);
        continue;
      }
      audioSec = wavSeconds(readFileSync(wav));
      const t0 = performance.now();
      try {
        transcript = server ? await transcribeServer(server, wav, arg("prompt")) : transcribeCli(whisper!, model!, wav, arg("threads"), arg("prompt"));
      } catch (err) {
        error = (err as Error).message;
        transcript = "";
      }
      latencyMs = Math.round(performance.now() - t0);
    }
    const out = transcript ? route(transcript, BENCH_CONTEXT) : { intent: null, echo: "" };
    const actual = signature(out.intent);
    const ok = !error && matches(c.expected, actual);
    rows.push({ file: c.file, expected: c.expected, actual, ok, latencyMs, audioSec: Number(audioSec.toFixed(2)), transcript, echo: out.echo, ...(error ? { error } : {}) });
    console.log(`${ok ? "OK  " : "MISS"}  ${String(latencyMs).padStart(6)} ms  ${c.file}  expected ${c.expected}, got ${actual}  "${transcript}"`);
  }

  const scored = rows.filter((r) => !("skipped" in r));
  const latencies = scored.map((r) => r.latencyMs as number);
  const correct = scored.filter((r) => r.ok).length;
  const summary = {
    mode: textOnly ? "text-only" : server ? "whisper-server" : "whisper-cli",
    cases: cases.length,
    scored: scored.length,
    routingAccuracy: scored.length ? Number((correct / scored.length).toFixed(3)) : 0,
    latencyMs: { median: pct(latencies, 50), p90: pct(latencies, 90), max: Math.max(0, ...latencies) },
  };
  console.log(`\nRouting accuracy ${correct}/${scored.length}; latency median ${summary.latencyMs.median} ms, p90 ${summary.latencyMs.p90} ms`);
  const outFile = resolve(arg("out") ?? join(here, "../../test/live-output/stt-bench.json"));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 2));
  console.log(`Wrote ${outFile}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}
