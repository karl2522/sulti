import { speakableError } from "./errors.js";

/**
 * Tracks agent messages per turn and decides what to read aloud when a turn
 * completes. Feed it app-server notifications in order.
 *
 * Rule (docs/PROTOCOL_NOTES.md): the answer is the text of the last
 * agentMessage whose item/completed phase is "final_answer". If no message
 * has that phase, use the last agentMessage of the turn.
 */
export type TurnOutcome =
  | { kind: "answer"; threadId: string; turnId: string; text: string }
  | { kind: "interrupted"; threadId: string; turnId: string }
  | { kind: "failed"; threadId: string; turnId: string; message: string }
  | { kind: "empty"; threadId: string; turnId: string };

interface Msg {
  id: string;
  text: string;
  phase: string | null;
}

interface AgentItem {
  type?: string;
  id?: string;
  text?: string;
  phase?: string | null;
}

export class TurnTracker {
  private readonly messages = new Map<string, Msg[]>();
  private readonly lastError = new Map<string, { info: unknown; message: string }>();

  /** Returns an outcome when the notification completes a turn. */
  feed(method: string, params: unknown): TurnOutcome | null {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === "item/completed") {
      const item = p.item as AgentItem | undefined;
      if (item?.type === "agentMessage" && typeof p.turnId === "string") this.addMessage(p.turnId, item);
      return null;
    }
    if (method === "error" && typeof p.turnId === "string") {
      const e = (p.error ?? {}) as { codexErrorInfo?: unknown; message?: string };
      if (!p.willRetry) this.lastError.set(p.turnId, { info: e.codexErrorInfo, message: e.message ?? "" });
      return null;
    }
    if (method === "turn/completed") {
      const turn = (p.turn ?? {}) as { id?: string; status?: string; items?: AgentItem[]; error?: { codexErrorInfo?: unknown; message?: string } | null };
      const threadId = String(p.threadId ?? "");
      const turnId = String(turn.id ?? "");
      // turn.items is a summary; merge it in case we missed item events.
      for (const item of turn.items ?? []) if (item.type === "agentMessage") this.addMessage(turnId, item);
      const msgs = this.messages.get(turnId) ?? [];
      const err = this.lastError.get(turnId);
      this.messages.delete(turnId);
      this.lastError.delete(turnId);
      if (turn.status === "interrupted") return { kind: "interrupted", threadId, turnId };
      if (turn.status === "failed") {
        const info = turn.error?.codexErrorInfo ?? err?.info;
        return { kind: "failed", threadId, turnId, message: speakableError(info, turn.error?.message ?? err?.message) };
      }
      const finals = msgs.filter((m) => m.phase === "final_answer" && m.text.trim());
      const pick = finals[finals.length - 1] ?? [...msgs].reverse().find((m) => m.text.trim());
      return pick ? { kind: "answer", threadId, turnId, text: pick.text } : { kind: "empty", threadId, turnId };
    }
    return null;
  }

  private addMessage(turnId: string, item: AgentItem): void {
    const list = this.messages.get(turnId) ?? [];
    const msg: Msg = { id: String(item.id ?? list.length), text: String(item.text ?? ""), phase: item.phase ?? null };
    const i = list.findIndex((m) => m.id === msg.id);
    if (i >= 0) list[i] = { ...msg, phase: msg.phase ?? list[i]!.phase };
    else list.push(msg);
    this.messages.set(turnId, list);
  }
}
