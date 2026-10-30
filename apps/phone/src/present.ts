import type { ActivityItem, Answer, SessionInfo, ThreadSummary } from "@sulti/core";
import type { AppState, ApprovalCard } from "./state.js";

export type Tone = "coral" | "lagoon" | "lilac" | "muted";

/** Which chat a session's prompts go to: [title, detail]. */
export function chatLine(s: SessionInfo, threads: ThreadSummary[] | undefined): [string, string] {
  if (!s.threadId) return ["New chat", "Starts with your next message"];
  const t = threads?.find((x) => x.id === s.threadId);
  if (!t) return ["Current chat", "Tap to switch chats"];
  return [t.name ?? firstLine(t.preview || "Untitled chat", 120), "Updated " + ago(t.updatedAt)];
}

export interface SessionView {
  session: SessionInfo;
  tone: Tone;
  icon: "shield" | "speaker" | "bars" | "spinner" | "alert" | "none";
  label: string;
  /** Second line: a command, an answer snippet, the goal... */
  detail: string;
  detailMono: boolean;
  /** Puts the session in "Needs you". */
  needsYou: boolean;
  approval?: ApprovalCard;
  answer?: Answer;
}

/** "just now", "12 min ago", "3 h ago", or a date. Accepts seconds or ms. */
export function ago(t: number, now = Date.now()): string {
  const ms = t < 1e12 ? t * 1000 : t;
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + " h ago";
  return new Date(ms).toLocaleDateString();
}

/** "45 s", "1 min 12 s", "2 h 5 min". */
export function span(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return s + " s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " min" + (m < 10 && s % 60 ? " " + (s % 60) + " s" : "");
  return Math.floor(m / 60) + " h " + (m % 60) + " min";
}

/** "2:14". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

export function initials(name: string): string {
  const words = name.replace(/[-_]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function firstLine(text: string, max = 140): string {
  // Headings and list items become sentences, so they don't run together.
  const line = text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:#{1,6}|[-*+>]|\d+[.)])\s+/, "").replace(/[*_`]/g, "").trim())
    .filter(Boolean)
    .map((l, i, all) => (i < all.length - 1 && !/[.!?:…]$/.test(l) ? l + "." : l))
    .join(" ")
    .replace(/\s+/g, " ");
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

const ACTIVITY_VERB: Record<ActivityItem["kind"], [string, string]> = {
  read: ["Reading", "Read"],
  search: ["Searching for", "Searched for"],
  list: ["Listing", "Listed"],
  command: ["Running", "Ran"],
  edit: ["Editing", "Edited"],
};

export function activityVerb(a: ActivityItem): string {
  return ACTIVITY_VERB[a.kind][a.status === "running" ? 0 : 1];
}

/** How one session should read in the list, most urgent state first. */
export interface Playing {
  sessionId: string;
  answerId: string;
  paused: boolean;
}

export function viewSession(state: AppState, s: SessionInfo, heard: ReadonlySet<string>, playing: Playing | null, now = Date.now()): SessionView {
  const base = { session: s, detailMono: false, needsYou: false };
  const approval = state.approvals.find((a) => a.sessionId === s.id);
  const answer = state.answers.find((a) => a.sessionId === s.id);
  const goal = state.goals[s.id];
  if (approval) {
    return { ...base, tone: "coral", icon: "shield", label: "Needs approval", detail: approval.command ?? approval.summary, detailMono: !!approval.command, needsYou: true, approval };
  }
  if (playing?.sessionId === s.id) {
    const a = state.answers.find((x) => x.id === playing.answerId) ?? answer;
    if (a) return { ...base, tone: "lagoon", icon: "bars", label: playing.paused ? "Paused" : "Reading aloud", detail: firstLine(a.text), answer: a };
  }
  if (s.status === "working") {
    const last = state.activity[s.id]?.at(-1);
    const detail = goal ? "Goal: " + goal.objective : last ? activityVerb(last) + " " + last.text : "Codex is on it";
    const mins = s.since ? Math.floor((now - s.since) / 60_000) : 0;
    const label = mins < 1 ? "Working" : mins < 60 ? "Working for " + mins + " min" : "Working for " + span(mins * 60);
    return { ...base, tone: "lilac", icon: "spinner", label, detail: firstLine(detail) };
  }
  if (answer && !heard.has(answer.id)) {
    return { ...base, tone: "lagoon", icon: "speaker", label: "Answer ready", detail: (answer.source === "hook" ? "From a terminal, " : "") + ago(answer.createdAt, now), needsYou: true, answer };
  }
  if (s.status === "error") return { ...base, tone: "coral", icon: "alert", label: "Last turn failed", detail: answer ? firstLine(answer.text) : "Open it to try again" };
  return { ...base, tone: "muted", icon: "none", label: s.unlisted ? "Listen only" : "Idle", detail: answer ? firstLine(answer.text) : "No answers yet", answer };
}
