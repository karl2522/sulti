import type { SessionStatus } from "@sulti/core";

/** Accepts unix seconds or milliseconds. */
export function ago(t: number): string {
  const ms = t < 1e12 ? t * 1000 : t;
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString();
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: "Idle",
  working: "Working",
  waitingApproval: "Needs approval",
  error: "Error",
};

export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}
