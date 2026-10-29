import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAIR_CODE_TTL_MS, Pairing } from "./pairing.js";
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

  it("rate-limits failed attempts", () => {
    let now = 5_000_000;
    const p = new Pairing(tmp(), () => now);
    for (let i = 0; i < 5; i++) expect(p.exchange("WRONGCODE" + i, null)).toMatchObject({ ok: false, status: 401 });
    const good = p.createCode();
    expect(p.exchange(good, null)).toMatchObject({ ok: false, status: 429 });
    now += 61_000;
    expect(p.exchange(good, null).ok).toBe(true);
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
