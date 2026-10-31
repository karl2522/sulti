import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAIR_CODE_TTL_MS, PAIR_REQUEST_TTL_MS, Pairing } from "./pairing.js";
import { AUDIO_URL_TTL_MS, signedAudioPath, verifyAudioSignature } from "./signing.js";
import { readJson } from "./store.js";

const tmp = () => mkdtempSync(join(tmpdir(), "sulti-test-"));

describe("pairing and auth", () => {
  it("exchanges a one-time code for a device token and stores only its hash", () => {
    const dir = tmp();
    const p = new Pairing(dir);
    const code = p.createCode();
    const res = p.exchange(code, "Test phone");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.deviceToken).toHaveLength(43); // 32 random bytes, base64url
    const stored = JSON.stringify(readJson(join(dir, "devices.json"), []));
    expect(stored).not.toContain(res.deviceToken);
    expect(p.verify(res.deviceToken)?.id).toBe(res.deviceId);
    expect(p.verify("x".repeat(43))).toBeNull();
    // Persisted: a fresh instance still accepts the token.
    expect(new Pairing(dir).verify(res.deviceToken)?.name).toBe("Test phone");
  });

  it("codes are single use and case-insensitive", () => {
    const p = new Pairing(tmp());
    const code = p.createCode();
    expect(p.exchange(code.toLowerCase(), null).ok).toBe(true);
    expect(p.exchange(code, null)).toMatchObject({ ok: false, status: 401 });
  });

  it("codes expire after 10 minutes", () => {
    let now = 1_000_000;
    const p = new Pairing(tmp(), () => now);
    const code = p.createCode();
    now += PAIR_CODE_TTL_MS + 1;
    expect(p.exchange(code, null)).toMatchObject({ ok: false, status: 401 });
  });

  it("rate-limits failed attempts per client", () => {
    let now = 5_000_000;
    const p = new Pairing(tmp(), () => now);
    for (let i = 0; i < 5; i++) expect(p.exchange("WRONGCODE" + i, null, "1.2.3.4")).toMatchObject({ ok: false, status: 401 });
    const good = p.createCode();
    expect(p.exchange(good, null, "1.2.3.4")).toMatchObject({ ok: false, status: 429 });
    // Someone else guessing doesn't lock out the owner's phone.
    expect(p.exchange(p.createCode(), null, "5.6.7.8").ok).toBe(true);
    now += 61_000;
    expect(p.exchange(good, null, "1.2.3.4").ok).toBe(true);
  });

  it("revokes devices", () => {
    const p = new Pairing(tmp());
    const res = p.exchange(p.createCode(), "a");
    if (!res.ok) throw new Error("pair failed");
    expect(p.revoke(res.deviceId)).toBe(true);
    expect(p.verify(res.deviceToken)).toBeNull();
    expect(p.revoke(res.deviceId)).toBe(false);
  });

  it("honors a revoke from another process without a restart, and never resurrects it", () => {
    const dir = tmp();
    const running = new Pairing(dir); // the companion
    const a = running.exchange(running.createCode(), "a");
    if (!a.ok) throw new Error("pair failed");
    expect(running.verify(a.deviceToken)).not.toBeNull();
    expect(new Pairing(dir).revoke(a.deviceId)).toBe(true); // `npm run devices -- revoke`
    expect(running.verify(a.deviceToken)).toBeNull();
    const b = running.exchange(running.createCode(), "b"); // a later pairing saves the list
    expect(b.ok).toBe(true);
    expect(new Pairing(dir).list().map((d) => d.name)).toEqual(["b"]);
  });
});

describe("pairing by approval from a paired phone", () => {
  const ask = (p: Pairing, client = "1.2.3.4") => {
    const r = p.request("iPhone", client, "PH");
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("hands the token over once, only after an Allow, and only with the secret", () => {
    const dir = tmp();
    const p = new Pairing(dir);
    const { info, secret } = ask(p);
    expect(info.match).toMatch(/^\d{2}$/);
    expect(p.pendingRequests().map((x) => x.requestId)).toEqual([info.requestId]);
    expect(p.poll(info.requestId, secret)).toEqual({ status: "pending" });
    expect(p.list()).toHaveLength(0); // nothing issued before the tap
    expect(p.respond(info.requestId, true)).toBe(true);
    expect(p.respond(info.requestId, false)).toBe(false); // already answered
    expect(p.poll(info.requestId, "wrong-secret")).toEqual({ status: "expired" });
    const got = p.poll(info.requestId, secret);
    if (got.status !== "approved") throw new Error("not approved");
    expect(p.verify(got.deviceToken)?.name).toBe("iPhone");
    expect(JSON.stringify(readJson(join(dir, "devices.json"), []))).not.toContain(got.deviceToken);
    expect(p.poll(info.requestId, secret)).toEqual({ status: "expired" }); // single handover
  });

  it("deny, cancel and expiry issue nothing", () => {
    let now = 1_000_000;
    const p = new Pairing(tmp(), () => now);
    const denied = ask(p);
    p.respond(denied.info.requestId, false);
    expect(p.poll(denied.info.requestId, denied.secret)).toEqual({ status: "denied" });
    const cancelled = ask(p);
    expect(p.poll(cancelled.info.requestId, cancelled.secret, true)).toEqual({ status: "cancelled" });
    expect(p.respond(cancelled.info.requestId, true)).toBe(false);
    const late = ask(p);
    now += PAIR_REQUEST_TTL_MS + 1;
    expect(p.respond(late.info.requestId, true)).toBe(false);
    expect(p.poll(late.info.requestId, late.secret)).toEqual({ status: "expired" });
    expect(p.list()).toHaveLength(0);
  });

  it("limits pending requests per client and in total", () => {
    const p = new Pairing(tmp());
    for (let i = 0; i < 3; i++) ask(p, "9.9.9.9");
    expect(p.request("x", "9.9.9.9", null).ok).toBe(false);
    for (let i = 0; i < 17; i++) ask(p, "10.0.0." + i);
    expect(p.request("x", "8.8.8.8", null).ok).toBe(false);
  });
});

describe("signed audio URLs", () => {
  const secret = "s".repeat(64);
  const parse = (path: string) => {
    const u = new URL(path, "http://x");
    return { exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") };
  };

  it("verifies a fresh signature for the same answer only", () => {
    const now = 1_700_000_000_000;
    const { exp, sig } = parse(signedAudioPath(secret, "answer-1", now));
    expect(verifyAudioSignature(secret, "answer-1", exp, sig, now)).toBe(true);
    expect(verifyAudioSignature(secret, "answer-2", exp, sig, now)).toBe(false);
    expect(verifyAudioSignature("t".repeat(64), "answer-1", exp, sig, now)).toBe(false);
  });

  it("expires after 10 minutes and rejects tampering", () => {
    const now = 1_700_000_000_000;
    const { exp, sig } = parse(signedAudioPath(secret, "a", now));
    expect(verifyAudioSignature(secret, "a", exp, sig, now + AUDIO_URL_TTL_MS + 1)).toBe(false);
    expect(verifyAudioSignature(secret, "a", String(Number(exp) + 1), sig, now)).toBe(false);
    expect(verifyAudioSignature(secret, "a", exp, sig!.slice(1), now)).toBe(false);
    expect(verifyAudioSignature(secret, "a", null, sig, now)).toBe(false);
    expect(verifyAudioSignature(secret, "a", "1e99", sig, now)).toBe(false);
  });

  it("rejects links that claim a longer lifetime than allowed", () => {
    const now = 1_700_000_000_000;
    const { exp, sig } = parse(signedAudioPath(secret, "a", now + 60 * 60 * 1000));
    expect(verifyAudioSignature(secret, "a", exp, sig, now)).toBe(false);
  });
});
