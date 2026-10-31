import type { Device } from "./storage.js";

/** Reads `#code=XXXX` from the pairing link. */
export function pairingCodeFromHash(hash: string): string | null {
  const m = /(?:^#|&)code=([A-Za-z0-9]{6,32})(?:&|$)/.exec(hash);
  return m ? m[1]!.toUpperCase() : null;
}

export async function pairDevice(code: string, deviceName: string): Promise<Device> {
  const body = await post<{ deviceId?: string; deviceToken?: string }>("/api/pair", { code, deviceName: deviceName.slice(0, 60) });
  if (!body.deviceId || !body.deviceToken) throw new Error("Pairing failed.");
  return { deviceId: body.deviceId, deviceToken: body.deviceToken, deviceName: deviceName.slice(0, 60), pairedAt: Date.now() };
}

export interface PairAsk {
  requestId: string;
  secret: string;
  match: string;
  expiresAt: number;
  /** How many paired phones had Sulti open and were asked. */
  asked: number;
}

/** Ask the phones that are already paired to let this one in. */
export function askToPair(deviceName: string): Promise<PairAsk> {
  return post<PairAsk>("/api/pair/request", { deviceName: deviceName.slice(0, 60) });
}

export type PairPoll = { status: "pending" | "denied" | "expired" | "cancelled" } | { status: "approved"; deviceId: string; deviceToken: string };

export function pollPair(ask: PairAsk, cancel = false): Promise<PairPoll> {
  return post<PairPoll>("/api/pair/poll", { requestId: ask.requestId, secret: ask.secret, cancel });
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch {
    throw new Error("Can't reach your PC. Is the companion running?");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Pairing failed (${res.status}).`);
  return body;
}
