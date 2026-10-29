import type { Device } from "./storage.js";

/** Reads `#code=XXXX` from the pairing link. */
export function pairingCodeFromHash(hash: string): string | null {
  const m = /(?:^#|&)code=([A-Za-z0-9]{6,32})(?:&|$)/.exec(hash);
  return m ? m[1]!.toUpperCase() : null;
}

export async function pairDevice(code: string, deviceName: string): Promise<Device> {
  let res: Response;
  try {
    res = await fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceName: deviceName.slice(0, 60) }),
    });
  } catch {
    throw new Error("Can't reach the companion. Is it running?");
  }
  const body = (await res.json().catch(() => ({}))) as { deviceId?: string; deviceToken?: string; error?: string };
  if (!res.ok || !body.deviceId || !body.deviceToken) throw new Error(body.error ?? `Pairing failed (${res.status}).`);
  return { deviceId: body.deviceId, deviceToken: body.deviceToken, deviceName: deviceName.slice(0, 60), pairedAt: Date.now() };
}
