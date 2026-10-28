import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { CompanionMessage, PhoneMessage } from "@sulti/core";
import { startCompanion, type CompanionHandle } from "../../apps/companion/src/companion.js";
import { loadConfig } from "../../apps/companion/src/config.js";
import { MOCK_SERVER } from "../mock-app-server/paths.js";

export const PUBLIC_URL = "https://sulti.example";
export const ORIGIN = PUBLIC_URL;

export const TEST_SESSIONS = [
  { name: "Sole Harbor", cwd: "D:\\work\\sole-harbor", aliases: ["soul harbor"] },
  { name: "Lead Tracker", cwd: "D:\\work\\lead-tracker", aliases: ["led tracker"] },
  { name: "Kernel Labs", cwd: "D:\\work\\kernel-labs", aliases: ["colonel labs"], sandbox: "read-only" },
];

/** A tiny valid WAV file (44-byte header + silence). */
export function fakeWav(bytes = 3200): Buffer {
  const b = Buffer.alloc(44 + bytes);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + bytes, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}

export interface TestCompanion {
  c: CompanionHandle;
  dataDir: string;
  logFile: string;
  copied: string[];
  rendered: string[];
  mockLog(): Record<string, unknown>[];
  stop(): Promise<void>;
}

export async function startTestCompanion(opts: { scenario?: string; mockArgs?: string[]; sessions?: unknown[] } = {}): Promise<TestCompanion> {
  const dataDir = mkdtempSync(join(tmpdir(), "sulti-it-"));
  const logFile = join(dataDir, "mock-requests.jsonl");
  writeFileSync(join(dataDir, "sessions.json"), JSON.stringify({ sessions: opts.sessions ?? TEST_SESSIONS }));
  const config = loadConfig({}, {
    dataDir,
    port: 0,
    hookPort: 0,
    publicUrl: PUBLIC_URL,
    appServerCommand: [process.execPath, MOCK_SERVER, "--scenario", opts.scenario ?? "normal", "--log", logFile, ...(opts.mockArgs ?? [])],
    dev: false,
  });
  const copied: string[] = [];
  const rendered: string[] = [];
  const c = await startCompanion(config, {
    backoff: [50, 100],
    renderAudio: async (text, out) => {
      rendered.push(text);
      writeFileSync(out, fakeWav());
    },
    copyToPc: async (text) => void copied.push(text),
  });
  await c.conn.ready(10_000);
  return {
    c,
    dataDir,
    logFile,
    copied,
    rendered,
    mockLog: () => (existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : []),
    stop: () => c.stop(),
  };
}

export async function pairDevice(t: TestCompanion, origin = ORIGIN): Promise<string> {
  const code = t.c.newPairing().code;
  const res = await fetch(`http://127.0.0.1:${t.c.phone.port}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ code, deviceName: "Test iPhone" }),
  });
  if (!res.ok) throw new Error(`pair failed: ${res.status}`);
  return ((await res.json()) as { deviceToken: string }).deviceToken;
}

export class Phone {
  readonly received: CompanionMessage[] = [];
  private waiters: { pred: (m: CompanionMessage) => boolean; resolve: (m: CompanionMessage) => void }[] = [];
  closeCode: number | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as CompanionMessage;
      this.received.push(m);
      for (const w of [...this.waiters]) {
        if (w.pred(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
    ws.on("close", (code) => (this.closeCode = code));
  }

  static open(port: number, origin = ORIGIN): Promise<Phone> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: origin } });
      const p = new Phone(ws);
      ws.once("open", () => resolve(p));
      ws.once("error", reject);
    });
  }

  static async connect(t: TestCompanion): Promise<Phone> {
    const token = await pairDevice(t);
    const p = await Phone.open(t.c.phone.port);
    p.send({ type: "auth", deviceToken: token });
    await p.waitFor((m) => m.type === "auth.ok");
    await p.waitFor((m) => m.type === "sessions");
    return p;
  }

  send(m: PhoneMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(m));
  }

  /** Wait for a message (including ones already received after "since"). */
  waitFor<T extends CompanionMessage["type"]>(
    pred: ((m: CompanionMessage) => boolean) | T,
    timeoutMs = 8000,
    since = 0,
  ): Promise<CompanionMessage> {
    const fn = typeof pred === "string" ? (m: CompanionMessage) => m.type === pred : pred;
    const hit = this.received.slice(since).find(fn);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout waiting for message; got: " + this.received.map((m) => m.type).join(","))), timeoutMs);
      this.waiters.push({ pred: fn, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  }

  mark(): number {
    return this.received.length;
  }

  close(): void {
    this.ws.close();
  }
}

export function waitClose(ws: WebSocket, timeoutMs = 8000): Promise<number> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("socket did not close")), timeoutMs);
    ws.once("close", (code) => {
      clearTimeout(t);
      resolve(code);
    });
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
