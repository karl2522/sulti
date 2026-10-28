import { z } from "zod";

/**
 * Body that scripts/hooks/stop-hook.mjs POSTs to /hook/stop. The hook
 * normalizes Codex's Stop payload (or the legacy notify payload) to this.
 */
export const StopHookBody = z.object({
  event: z.string().max(64).optional(),
  cwd: z.string().min(1).max(4096),
  sessionId: z.string().max(200).nullable().optional(),
  turnId: z.string().max(200).nullable().optional(),
  lastAssistantMessage: z.string().max(1_000_000).nullable().optional(),
});
export type StopHookBody = z.infer<typeof StopHookBody>;

export type ParsedStop = { ok: true; cwd: string; sessionId: string | null; turnId: string | null; message: string } | { ok: false; reason: string };

export function parseStopHookBody(raw: unknown): ParsedStop {
  const res = StopHookBody.safeParse(raw);
  if (!res.success) return { ok: false, reason: "invalid body" };
  const b = res.data;
  if (b.event && b.event !== "Stop" && b.event !== "agent-turn-complete") return { ok: false, reason: "ignored event" };
  const message = (b.lastAssistantMessage ?? "").trim();
  if (!message) return { ok: false, reason: "no message" };
  return { ok: true, cwd: b.cwd, sessionId: b.sessionId ?? null, turnId: b.turnId ?? null, message };
}
