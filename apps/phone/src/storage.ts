/** Small typed wrappers around localStorage. The device token never leaves this file except to auth. */

export interface Device {
  deviceId: string;
  deviceToken: string;
  deviceName: string;
  pairedAt: number;
}

export type PlaybackMode = "A" | "B";
export type AutoRead = "off" | "tap" | "auto";

export interface Settings {
  /** A: Web Speech on the phone. B: audio rendered on the PC. */
  mode: PlaybackMode;
  voiceName: string | null;
  rate: number;
  /** off (default), after a tap on the "new answer" banner, or automatic. */
  autoRead: AutoRead;
  readCodeBlocks: boolean;
}

export const DEFAULT_SETTINGS: Settings = { mode: "A", voiceName: null, rate: 1, autoRead: "off", readCodeBlocks: false };

const DEVICE_KEY = "sulti.device";
const SETTINGS_KEY = "sulti.settings";

function read<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

export function loadDevice(): Device | null {
  const d = read<Device>(DEVICE_KEY);
  if (!d || typeof d.deviceToken !== "string" || typeof d.deviceId !== "string") return null;
  return { deviceId: d.deviceId, deviceToken: d.deviceToken, deviceName: d.deviceName ?? "Phone", pairedAt: d.pairedAt ?? 0 };
}

export function saveDevice(d: Device): void {
  localStorage.setItem(DEVICE_KEY, JSON.stringify(d));
}

export function forgetDevice(): void {
  localStorage.removeItem(DEVICE_KEY);
}

export function loadSettings(): Settings {
  const s = read<Settings>(SETTINGS_KEY) ?? {};
  return {
    mode: s.mode === "B" ? "B" : "A",
    voiceName: typeof s.voiceName === "string" ? s.voiceName : null,
    rate: typeof s.rate === "number" && s.rate >= 0.5 && s.rate <= 2 ? s.rate : 1,
    autoRead: s.autoRead === "tap" || s.autoRead === "auto" ? s.autoRead : "off",
    readCodeBlocks: s.readCodeBlocks === true,
  };
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
