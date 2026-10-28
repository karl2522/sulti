import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { readJson, writeJson } from "./store.js";

export const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_FAILED_PER_WINDOW = 5;
const FAIL_WINDOW_MS = 60 * 1000;

export interface DeviceRecord {
  id: string;
  name: string;
  /** SHA-256 of the device token, hex. The token itself is never stored. */
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number | null;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type PairResult = { ok: true; deviceId: string; deviceToken: string } | { ok: false; status: 400 | 401 | 429; error: string };

/** One-time pairing codes and the device registry (devices.json). */
export class Pairing {
  private readonly file: string;
  private devices: DeviceRecord[];
  private readonly codes = new Map<string, number>(); // codeHash -> expiresAt
  private failures: number[] = [];

  constructor(
    dataDir: string,
    private readonly now: () => number = Date.now,
  ) {
    this.file = join(dataDir, "devices.json");
    this.devices = readJson<DeviceRecord[]>(this.file, []);
  }

  /** New single-use code, valid for 10 minutes. Base32-ish, no ambiguous chars. */
  createCode(): string {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(10);
    let code = "";
    for (const b of bytes) code += alphabet[b % alphabet.length];
    this.codes.set(sha256(code), this.now() + PAIR_CODE_TTL_MS);
    return code;
  }

  /** Exchange a pairing code for a device token. Rate-limited on failures. */
  exchange(code: unknown, deviceName: unknown): PairResult {
    const now = this.now();
    this.failures = this.failures.filter((t) => now - t < FAIL_WINDOW_MS);
    if (this.failures.length >= MAX_FAILED_PER_WINDOW) return { ok: false, status: 429, error: "Too many attempts. Wait a minute." };
    if (typeof code !== "string" || !/^[A-Z0-9]{6,32}$/.test(code.trim().toUpperCase())) {
      this.failures.push(now);
      return { ok: false, status: 400, error: "Invalid pairing code." };
    }
    const h = sha256(code.trim().toUpperCase());
    const exp = this.codes.get(h);
    if (!exp || exp < now) {
      this.codes.delete(h);
      this.failures.push(now);
      return { ok: false, status: 401, error: "Pairing code expired or already used." };
    }
    this.codes.delete(h); // single use
    const deviceToken = randomBytes(32).toString("base64url");
    const name = typeof deviceName === "string" && deviceName.trim() ? deviceName.trim().slice(0, 60) : "iPhone";
    const rec: DeviceRecord = { id: randomUUID().slice(0, 8), name, tokenHash: sha256(deviceToken), createdAt: now, lastSeenAt: null };
    this.devices.push(rec);
    this.save();
    return { ok: true, deviceId: rec.id, deviceToken };
  }

  /** Device for a token, or null. Constant-time compare on the hashes. */
  verify(token: unknown): DeviceRecord | null {
    if (typeof token !== "string" || token.length < 16 || token.length > 200) return null;
    const h = Buffer.from(sha256(token));
    for (const d of this.devices) {
      const stored = Buffer.from(d.tokenHash);
      if (stored.length === h.length && timingSafeEqual(stored, h)) {
        d.lastSeenAt = this.now();
        this.save();
        return d;
      }
    }
    return null;
  }

  list(): DeviceRecord[] {
    return this.devices.map((d) => ({ ...d }));
  }

  revoke(id: string): boolean {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    if (this.devices.length === before) return false;
    this.save();
    return true;
  }

  private save(): void {
    writeJson(this.file, this.devices);
  }
}
