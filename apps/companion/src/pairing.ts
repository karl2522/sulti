import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { readJson, writeJson } from "./store.js";

export const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
/** How long a "let me in" request from a new device waits for a tap on a paired one. */
export const PAIR_REQUEST_TTL_MS = 2 * 60 * 1000;
const MAX_FAILED_PER_WINDOW = 5;
const FAIL_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_CLIENT = 3;
const MAX_REQUESTS = 20;

export interface DeviceRecord {
  id: string;
  name: string;
  /** SHA-256 of the device token, hex. The token itself is never stored. */
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number | null;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const cleanName = (n: unknown) => (typeof n === "string" && n.trim() ? n.trim().slice(0, 60) : "iPhone");

export type PairResult = { ok: true; deviceId: string; deviceToken: string } | { ok: false; status: 400 | 401 | 429; error: string };

/** What a paired device sees when asked to let a new one in. */
export interface PairRequestInfo {
  requestId: string;
  deviceName: string;
  /** Two digits shown on both screens, so you approve the device in front of you. */
  match: string;
  place: string | null;
  expiresAt: number;
}

interface PairRequest extends PairRequestInfo {
  secretHash: string;
  client: string;
  status: "pending" | "approved" | "denied";
}

export type PollResult = { status: "pending" } | { status: "approved"; deviceId: string; deviceToken: string } | { status: "denied" | "expired" | "cancelled" };

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
  private readonly requests = new Map<string, PairRequest>();

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
    return { ok: true, ...this.issue(deviceName) };
  }

  /** True while a code is still unused and unexpired (the PC's QR page watches this). */
  isPending(code: string): boolean {
    const exp = this.codes.get(sha256(code.trim().toUpperCase()));
    return !!exp && exp >= this.now();
  }

  /** A new device asks to be let in; a paired device approves it. Limited per client. */
  request(deviceName: unknown, client: string, place: string | null): { ok: true; info: PairRequestInfo; secret: string } | { ok: false; error: string } {
    this.expireRequests();
    const live = [...this.requests.values()].filter((r) => r.status === "pending");
    if (live.length >= MAX_REQUESTS || live.filter((r) => r.client === client).length >= MAX_REQUESTS_PER_CLIENT) return { ok: false, error: "Too many requests. Wait a minute." };
    const secret = randomBytes(24).toString("base64url");
    const info: PairRequestInfo = {
      requestId: randomUUID(),
      deviceName: cleanName(deviceName),
      match: String(10 + (randomBytes(1)[0]! % 90)),
      place: place && /^[A-Z]{2}$/.test(place) && place !== "XX" ? place : null,
      expiresAt: this.now() + PAIR_REQUEST_TTL_MS,
    };
    this.requests.set(info.requestId, { ...info, secretHash: sha256(secret), client, status: "pending" });
    return { ok: true, info, secret };
  }

  pendingRequests(): PairRequestInfo[] {
    this.expireRequests();
    return [...this.requests.values()].filter((r) => r.status === "pending").map(({ requestId, deviceName, match, place, expiresAt }) => ({ requestId, deviceName, match, place, expiresAt }));
  }

  /** A paired device's answer. Returns false when the request is gone or already answered. */
  respond(requestId: string, accept: boolean): boolean {
    this.expireRequests();
    const r = this.requests.get(requestId);
    if (!r || r.status !== "pending") return false;
    r.status = accept ? "approved" : "denied";
    return true;
  }

  /**
   * The waiting device asks how it went. The device token is created only now, as it is
   * handed over, so an approval nobody collects leaves no device behind. cancel drops the request.
   */
  poll(requestId: unknown, secret: unknown, cancel = false): PollResult {
    this.expireRequests();
    const r = typeof requestId === "string" ? this.requests.get(requestId) : undefined;
    if (!r || typeof secret !== "string") return { status: "expired" };
    const a = Buffer.from(sha256(secret));
    const b = Buffer.from(r.secretHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { status: "expired" };
    if (r.status === "pending" && !cancel) return { status: "pending" };
    this.requests.delete(r.requestId);
    if (cancel) return { status: "cancelled" };
    return r.status === "approved" ? { status: "approved", ...this.issue(r.deviceName) } : { status: "denied" };
  }

  private expireRequests(): void {
    const now = this.now();
    // Answered requests wait a little longer so the device can still collect the result.
    for (const [id, r] of this.requests) if (r.expiresAt + (r.status === "pending" ? 0 : 60_000) < now) this.requests.delete(id);
  }

  private issue(deviceName: unknown): { deviceId: string; deviceToken: string } {
    this.reload();
    const deviceToken = randomBytes(32).toString("base64url");
    const rec: DeviceRecord = { id: randomUUID().slice(0, 8), name: cleanName(deviceName), tokenHash: sha256(deviceToken), createdAt: this.now(), lastSeenAt: null };
    this.devices.push(rec);
    this.save();
    return { deviceId: rec.id, deviceToken };
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
