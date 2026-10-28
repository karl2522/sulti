import { createHmac, timingSafeEqual } from "node:crypto";

/** Audio URLs are signed because an <audio> element can't send auth headers. */
export const AUDIO_URL_TTL_MS = 10 * 60 * 1000;

function sign(secret: string, answerId: string, exp: number): string {
  return createHmac("sha256", secret).update(`audio:${answerId}:${exp}`).digest("base64url");
}

export function signedAudioPath(secret: string, answerId: string, now = Date.now()): string {
  const exp = now + AUDIO_URL_TTL_MS;
  return `/api/answers/${encodeURIComponent(answerId)}/audio?exp=${exp}&sig=${sign(secret, answerId, exp)}`;
}

export function verifyAudioSignature(secret: string, answerId: string, expRaw: string | null, sig: string | null, now = Date.now()): boolean {
  if (!expRaw || !sig || !/^\d{1,16}$/.test(expRaw)) return false;
  const exp = Number(expRaw);
  // Reject expired links and links that claim to live longer than the TTL.
  if (exp < now || exp > now + AUDIO_URL_TTL_MS + 5_000) return false;
  const expected = Buffer.from(sign(secret, answerId, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
