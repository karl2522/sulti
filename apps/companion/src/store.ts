import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Atomic JSON write (temp file + rename) so a crash never leaves half a file. */
export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + "." + randomBytes(4).toString("hex") + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
}

/**
 * Read a JSON file the owner may have edited by hand. Strips a UTF-8 byte-order
 * mark, which Windows PowerShell 5.1 (Set-Content -Encoding UTF8) and some
 * editors write and JSON.parse rejects.
 */
export function readJsonText(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return readJsonText(file) as T;
  } catch {
    return fallback;
  }
}

export interface Secrets {
  hookSecret: string;
  signingSecret: string;
}

/** secrets.json: created on first run with fresh random values. */
export function loadSecrets(dataDir: string): Secrets {
  const file = join(dataDir, "secrets.json");
  const cur = readJson<Partial<Secrets>>(file, {});
  if (cur.hookSecret && cur.signingSecret) return cur as Secrets;
  const next: Secrets = {
    hookSecret: cur.hookSecret ?? randomBytes(32).toString("hex"),
    signingSecret: cur.signingSecret ?? randomBytes(32).toString("hex"),
  };
  writeJson(file, next);
  return next;
}

/** threads.json: session id -> Codex thread id. */
export class ThreadStore {
  private readonly file: string;
  private map: Record<string, string>;
  constructor(dataDir: string) {
    this.file = join(dataDir, "threads.json");
    this.map = readJson<Record<string, string>>(this.file, {});
  }
  get(sessionId: string): string | null {
    return this.map[sessionId] ?? null;
  }
  set(sessionId: string, threadId: string): void {
    this.map[sessionId] = threadId;
    writeJson(this.file, this.map);
  }
  delete(sessionId: string): void {
    delete this.map[sessionId];
    writeJson(this.file, this.map);
  }
  all(): Record<string, string> {
    return { ...this.map };
  }
}
