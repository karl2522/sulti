import type { ActivityItem, Answer, CompanionMessage, CompanionMessageOf, Goal, SessionInfo, SkillInfo, ThreadSummary } from "@sulti/core";
import type { ConnStatus } from "./connection.js";

export type ApprovalCard = CompanionMessageOf<"approval.request"> & { sent?: boolean; receivedAt: number };
export type ToastLevel = "info" | "warn" | "error";
export interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
}

export interface AppState {
  conn: ConnStatus;
  deviceId: string | null;
  version: string | null;
  /** The PC's name, from the companion. */
  host: string | null;
  /** False until the first session list arrives (shows skeletons, not "no sessions"). */
  loaded: boolean;
  sessions: SessionInfo[];
  activeSessionId: string | null;
  /** Newest first. */
  answers: Answer[];
  approvals: ApprovalCard[];
  skills: Record<string, SkillInfo[]>;
  goals: Record<string, Goal | null>;
  threads: Record<string, ThreadSummary[]>;
  activity: Record<string, ActivityItem[]>;
  echo: string | null;
  toasts: Toast[];
  nextToastId: number;
}

export const initialState: AppState = {
  conn: "connecting",
  deviceId: null,
  version: null,
  host: null,
  loaded: false,
  sessions: [],
  activeSessionId: null,
  answers: [],
  approvals: [],
  skills: {},
  goals: {},
  threads: {},
  activity: {},
  echo: null,
  toasts: [],
  nextToastId: 1,
};

export type Action =
  | { type: "msg"; msg: CompanionMessage }
  | { type: "conn"; conn: ConnStatus }
  | { type: "toast"; level: ToastLevel; message: string }
  | { type: "dismissToast"; id: number }
  | { type: "approvalSent"; requestId: string }
  | { type: "echo"; echo: string | null };

const MAX_ANSWERS = 60;
const MAX_TOASTS = 3;

function toast(s: AppState, level: ToastLevel, message: string): AppState {
  const t: Toast = { id: s.nextToastId, level, message };
  return { ...s, toasts: [...s.toasts, t].slice(-MAX_TOASTS), nextToastId: s.nextToastId + 1 };
}

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "conn":
      return { ...s, conn: a.conn };
    case "toast":
      return toast(s, a.level, a.message);
    case "dismissToast":
      return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };
    case "approvalSent":
      return { ...s, approvals: s.approvals.map((x) => (x.requestId === a.requestId ? { ...x, sent: true } : x)) };
    case "echo":
      return { ...s, echo: a.echo };
    case "msg":
      return onMessage(s, a.msg);
  }
}

function onMessage(s: AppState, m: CompanionMessage): AppState {
  switch (m.type) {
    case "auth.ok":
      // The companion re-sends what is still pending right after this; anything
      // resolved while we were away must not linger.
      return { ...s, deviceId: m.deviceId, version: m.version, host: m.host ?? null, approvals: [], activity: {} };
    case "sessions":
      return { ...s, loaded: true, sessions: m.sessions, activeSessionId: m.activeSessionId };
    case "session.status":
      return { ...s, sessions: s.sessions.map((x) => (x.id === m.sessionId ? { ...x, status: m.status, since: m.since ?? Date.now() } : x)) };
    case "answer": {
      const { type: _type, ...answer } = m;
      if (s.answers.some((x) => x.id === answer.id)) return s;
      const answers = [answer, ...s.answers].sort((x, y) => y.createdAt - x.createdAt).slice(0, MAX_ANSWERS);
      return { ...s, answers };
    }
    case "route.result":
      return { ...s, echo: m.echo };
    case "skills":
      return { ...s, skills: { ...s.skills, [m.sessionId]: m.skills } };
    case "goal":
      return { ...s, goals: { ...s.goals, [m.sessionId]: m.goal } };
    case "approval.request":
      if (s.approvals.some((x) => x.requestId === m.requestId)) return s;
      return { ...s, approvals: [...s.approvals, { ...m, receivedAt: Date.now() }] };
    case "approval.resolved":
      return { ...s, approvals: s.approvals.filter((x) => x.requestId !== m.requestId) };
    case "threads":
      return { ...s, threads: { ...s.threads, [m.sessionId]: m.threads } };
    case "toast":
      return toast(s, m.level, m.message);
    case "audio.url":
    case "audio.failed":
      return s; // handled by the player
    case "activity":
      return { ...s, activity: { ...s.activity, [m.sessionId]: m.items } };
  }
}

export function sessionName(s: AppState, id: string): string {
  return s.sessions.find((x) => x.id === id)?.name ?? id;
}

export function latestAnswer(s: AppState, sessionId: string): Answer | undefined {
  return s.answers.find((a) => a.sessionId === sessionId);
}
