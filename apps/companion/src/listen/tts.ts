import { randomBytes } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chunkSpeech } from "@sulti/core";
import { runPowerShell } from "./powershell.js";

const here = dirname(fileURLToPath(import.meta.url));
/** scripts/tts.ps1 ships next to the package (works from src/ and dist/). */
export function ttsScriptPath(): string {
  for (const p of [resolve(here, "../../scripts/tts.ps1"), resolve(here, "../../../scripts/tts.ps1")]) if (existsSync(p)) return p;
  return resolve(here, "../../scripts/tts.ps1");
}

export interface TtsOptions {
  voice?: string;
  rate?: number;
}

/** Render speech text to a WAV file with System.Speech via Windows PowerShell 5.1. */
export async function renderWav(speechText: string, outFile: string, opts: TtsOptions = {}): Promise<void> {
  const textFile = join(tmpdir(), `sulti-tts-${randomBytes(6).toString("hex")}.txt`);
  // One chunk per line keeps sentence pauses natural in SAPI.
  writeFileSync(textFile, chunkSpeech(speechText).join("\n"), "utf8");
  try {
    const args = ["-File", ttsScriptPath(), "-TextFile", textFile, "-OutFile", outFile];
    if (opts.voice) args.push("-Voice", opts.voice);
    if (opts.rate !== undefined) args.push("-Rate", String(opts.rate));
    const res = await runPowerShell(args, 10 * 60_000);
    if (res.code !== 0 || !existsSync(outFile)) throw new Error(`TTS failed: ${res.stderr.trim().split("\n")[0] ?? "unknown error"}`);
  } finally {
    rmSync(textFile, { force: true });
  }
}

export async function listVoices(): Promise<string[]> {
  const res = await runPowerShell(["-File", ttsScriptPath(), "-ListVoices"], 30_000);
  if (res.code !== 0) return [];
  return res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
