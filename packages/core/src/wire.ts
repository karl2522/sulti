/**
 * Wire contract between the phone app and the companion.
 * Every message is a JSON object with a string "type". Both sides validate
 * with these zod schemas; anything that fails validation is dropped.
 */
import { z } from "zod";

export const MAX_GOAL_OBJECTIVE = 4000;
export const MAX_TEXT = 20000;

const id = z.string().min(1).max(200);
const text = z.string().max(MAX_TEXT);

// ---------- shared value types ----------

export const SessionStatus = z.enum(["idle", "working", "waitingApproval", "error"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SessionInfo = z.object({
  id,
  name: z.string(),
  aliases: z.array(z.string()),
  status: SessionStatus,
  /** true for folders that sent a Stop-hook answer but are not in sessions.json */
  unlisted: z.boolean(),
  threadId: z.string().nullable(),
  /** When the current status began (ms since epoch), for "Working for 2 min". */
  since: z.number().nullable().optional(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

/** Mirrors the installed Codex `ThreadGoalStatus` (verified in T1). */
export const GoalStatus = z.enum(["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"]);
export type GoalStatus = z.infer<typeof GoalStatus>;

export const Goal = z.object({
  objective: z.string(),
  status: GoalStatus,
  tokenBudget: z.number().nullable(),
  tokensUsed: z.number(),
  timeUsedSeconds: z.number(),
  updatedAt: z.number(),
});
export type Goal = z.infer<typeof Goal>;

export const ApprovalDecision = z.enum(["accept", "acceptForSession", "decline", "cancel"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const ApprovalKind = z.enum(["command", "fileChange"]);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const AnswerSource = z.enum(["appServer", "hook"]);
export type AnswerSource = z.infer<typeof AnswerSource>;

export const SkillInfo = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
});
export type SkillInfo = z.infer<typeof SkillInfo>;

export const ThreadSummary = z.object({
  id,
  preview: z.string(),
  name: z.string().nullable(),
  updatedAt: z.number(),
});
export type ThreadSummary = z.infer<typeof ThreadSummary>;

/** One line of "what Codex is doing right now", derived from command and file-change items. */
export const ActivityItem = z.object({
  id,
  kind: z.enum(["read", "search", "list", "command", "edit"]),
  text: z.string().max(500),
  status: z.enum(["running", "done", "failed"]),
  at: z.number(),
});
export type ActivityItem = z.infer<typeof ActivityItem>;

export const PlaybackAction = z.enum(["read", "again", "pause", "resume", "restart", "stop"]);
export type PlaybackAction = z.infer<typeof PlaybackAction>;

/** A new device asking to connect; a paired phone allows or denies it. */
export const PairRequest = z.object({
  requestId: id,
  deviceName: z.string().max(60),
  /** Two digits shown on both screens. */
  match: z.string().max(4),
  /** Country code from Cloudflare, when known. */
  place: z.string().max(2).nullable(),
  expiresAt: z.number(),
});
export type PairRequest = z.infer<typeof PairRequest>;

/** Output of the intent router (packages/core/src/router.ts). */
const intentMeta = { confidence: z.number().min(0).max(1), needsConfirm: z.boolean() };

export const AppIntent = z.object({
  kind: z.literal("app"),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("switchSession"), sessionId: id.nullable(), spoken: z.string() }),
    z.object({ type: z.literal("playback"), playback: PlaybackAction }),
    z.object({ type: z.literal("copy"), target: z.enum(["ask", "phone", "pc"]) }),
    z.object({ type: z.literal("showApprovals") }),
  ]),
  ...intentMeta,
});

export const CodexIntent = z.object({
  kind: z.literal("codex"),
  sessionId: id,
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("goal.set"), objective: z.string().min(1).max(MAX_GOAL_OBJECTIVE) }),
    z.object({ type: z.literal("goal.get") }),
    z.object({ type: z.literal("goal.update"), status: z.enum(["active", "paused"]) }),
    z.object({ type: z.literal("goal.clear") }),
    z.object({ type: z.literal("interrupt") }),
    z.object({ type: z.literal("skill"), skill: z.string().min(1), text: z.string().optional() }),
    /** Start a fresh Codex chat in this session, optionally with a first prompt. */
    z.object({ type: z.literal("thread.new"), text: z.string().optional() }),
  ]),
  ...intentMeta,
});

export const PromptIntent = z.object({
  kind: z.literal("prompt"),
  sessionId: id,
  text: z.string().min(1),
  ...intentMeta,
});

export const Intent = z.discriminatedUnion("kind", [AppIntent, CodexIntent, PromptIntent]);
export type Intent = z.infer<typeof Intent>;
export type AppIntent = z.infer<typeof AppIntent>;
export type CodexIntent = z.infer<typeof CodexIntent>;
export type PromptIntent = z.infer<typeof PromptIntent>;

// ---------- phone -> companion ----------

export const PhoneMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), deviceToken: z.string().min(16).max(200) }),
  z.object({ type: z.literal("sessions.list") }),
  z.object({ type: z.literal("session.select"), sessionId: id }),
  z.object({ type: z.literal("utterance"), text: text.min(1), sessionId: id.optional() }),
  z.object({ type: z.literal("route.confirm"), routeId: id, accept: z.boolean() }),
  z.object({ type: z.literal("prompt.send"), sessionId: id, text: text.min(1) }),
  z.object({ type: z.literal("skill.invoke"), sessionId: id, skill: z.string().min(1).max(200), text: text.optional() }),
  z.object({ type: z.literal("goal.get"), sessionId: id }),
  z.object({ type: z.literal("goal.set"), sessionId: id, objective: z.string().trim().min(1).max(MAX_GOAL_OBJECTIVE) }),
  z.object({ type: z.literal("goal.update"), sessionId: id, status: z.enum(["active", "paused"]) }),
  z.object({ type: z.literal("goal.clear"), sessionId: id }),
  z.object({ type: z.literal("turn.interrupt"), sessionId: id }),
  z.object({ type: z.literal("approval.respond"), requestId: id, decision: ApprovalDecision }),
  z.object({ type: z.literal("answer.copyToPc"), answerId: id }),
  z.object({ type: z.literal("answer.audioUrl"), answerId: id }),
  z.object({ type: z.literal("thread.list"), sessionId: id }),
  z.object({ type: z.literal("thread.attach"), sessionId: id, threadId: id }),
  z.object({ type: z.literal("thread.new"), sessionId: id }),
  z.object({ type: z.literal("pair.respond"), requestId: id, accept: z.boolean() }),
]);
export type PhoneMessage = z.infer<typeof PhoneMessage>;

// ---------- companion -> phone ----------

export const Answer = z.object({
  id,
  sessionId: id,
  turnId: z.string(),
  text: z.string(),
  speechText: z.string(),
  createdAt: z.number(),
  source: AnswerSource,
});
export type Answer = z.infer<typeof Answer>;

export const ApprovalRequest = z.object({
  type: z.literal("approval.request"),
  requestId: id,
  sessionId: id,
  kind: ApprovalKind,
  summary: z.string(),
  /** Codex's own explanation of why it needs approval, when it gave one. */
  reason: z.string().max(2000).optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

export const CompanionMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth.ok"), deviceId: z.string(), appName: z.string(), version: z.string(), host: z.string().max(100).optional() }),
  z.object({ type: z.literal("sessions"), sessions: z.array(SessionInfo), activeSessionId: z.string().nullable() }),
  z.object({ type: z.literal("session.status"), sessionId: id, status: SessionStatus, since: z.number().optional() }),
  z.object({ type: z.literal("activity"), sessionId: id, items: z.array(ActivityItem).max(20) }),
  Answer.extend({ type: z.literal("answer") }),
  z.object({ type: z.literal("route.result"), routeId: id, intent: Intent, echo: z.string(), needsConfirm: z.boolean() }),
  z.object({ type: z.literal("skills"), sessionId: id, skills: z.array(SkillInfo) }),
  z.object({ type: z.literal("goal"), sessionId: id, goal: Goal.nullable() }),
  ApprovalRequest,
  z.object({ type: z.literal("approval.resolved"), requestId: id }),
  z.object({ type: z.literal("threads"), sessionId: id, threads: z.array(ThreadSummary) }),
  z.object({ type: z.literal("audio.url"), answerId: id, url: z.string() }),
  z.object({ type: z.literal("audio.failed"), answerId: id, message: z.string() }),
  z.object({ type: z.literal("toast"), level: z.enum(["info", "warn", "error"]), message: z.string() }),
  PairRequest.extend({ type: z.literal("pair.request") }),
  z.object({ type: z.literal("pair.resolved"), requestId: id }),
]);
export type CompanionMessage = z.infer<typeof CompanionMessage>;

export type PhoneMessageOf<T extends PhoneMessage["type"]> = Extract<PhoneMessage, { type: T }>;
export type CompanionMessageOf<T extends CompanionMessage["type"]> = Extract<CompanionMessage, { type: T }>;

/** Parse a raw WebSocket frame from the phone. Returns null when invalid. */
export function parsePhoneMessage(raw: string): PhoneMessage | null {
  return parseWith(PhoneMessage, raw);
}

/** Parse a raw WebSocket frame from the companion. Returns null when invalid. */
export function parseCompanionMessage(raw: string): CompanionMessage | null {
  return parseWith(CompanionMessage, raw);
}

function parseWith<T>(schema: z.ZodType<T>, raw: string): T | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}
