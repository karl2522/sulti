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

/**
 * One-time pairing codes and the device registry (devices.json).
 * devices.json is re-read before every use: `npm run devices -- revoke` runs in
 * another process, and a cached copy would keep accepting the revoked token and
 * write it back on the next save.
 */
export class Pairing {
  private readonly file: string;
  private devices: DeviceRecord[];
  private readonly codes = new Map<string, number>(); // codeHash -> expiresAt
  /** Failed attempts per client (Cloudflare's visitor IP), so a stranger can't lock pairing for everyone. */
  private readonly failures = new Map<string, number[]>();

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
    const now = this.now();
    for (const [h, exp] of this.codes) if (exp < now) this.codes.delete(h);
    this.codes.set(sha256(code), now + PAIR_CODE_TTL_MS);
    return code;
  }

  /** Exchange a pairing code for a device token. Failures are rate-limited per client. */
  exchange(code: unknown, deviceName: unknown, client = "local"): PairResult {
    const now = this.now();
    for (const [k, times] of this.failures) {
      const recent = times.filter((t) => now - t < FAIL_WINDOW_MS);
      if (recent.length) this.failures.set(k, recent);
      else this.failures.delete(k);
    }
    const mine = this.failures.get(client) ?? [];
    if (mine.length >= MAX_FAILED_PER_WINDOW) return { ok: false, status: 429, error: "Too many attempts. Wait a minute." };
    const fail = () => void this.failures.set(client, [...mine, now]);
    if (typeof code !== "string" || !/^[A-Z0-9]{6,32}$/.test(code.trim().toUpperCase())) {
      fail();
      return { ok: false, status: 400, error: "Invalid pairing code." };
    }
    const h = sha256(code.trim().toUpperCase());
    const exp = this.codes.get(h);
    if (!exp || exp < now) {
      this.codes.delete(h);
      fail();
      return { ok: false, status: 401, error: "That code didn't work. It may be mistyped, already used, or older than 10 minutes." };
    }
    this.codes.delete(h); // single use
    this.reload();
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
    this.reload();
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
    this.reload();
    return this.devices.map((d) => ({ ...d }));
  }

  /** Still paired? (Revoke runs in another process, so re-read the file.) */
  has(id: string): boolean {
    this.reload();
    return this.devices.some((d) => d.id === id);
  }

  revoke(id: string): boolean {
    this.reload();
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    if (this.devices.length === before) return false;
    this.save();
    return true;
  }

  private reload(): void {
    this.devices = readJson<DeviceRecord[]>(this.file, []);
  }

  private save(): void {
    writeJson(this.file, this.devices);
  }
}
