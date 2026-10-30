/**
 * Intent router: turns one dictated utterance into an Intent.
 * Pure function of the utterance and the current context (sessions, skills,
 * active session). Approval words never approve anything.
 */
import { bestMatch, ACCEPT_THRESHOLD, CONFIRM_THRESHOLD, type Candidate, type Match } from "./fuzzy.js";
import { cleanupPrompt } from "./cleanup.js";
import { normalizeSpoken, tokenize } from "./normalize.js";
import type { Intent, PlaybackAction } from "./wire.js";
import { MAX_GOAL_OBJECTIVE } from "./wire.js";

export interface RouteContext {
  sessions: readonly Candidate[];
  skills: readonly { name: string }[];
  activeSessionId: string | null;
}

export type RouteOutput = { intent: Intent; echo: string } | { intent: null; echo: string };

const PLAYBACK: [string, PlaybackAction][] = [
  ["read the response", "read"], ["read the answer", "read"], ["read the reply", "read"], ["read it", "read"],
  ["read that", "read"], ["read it out", "read"], ["read it to me", "read"], ["read", "read"],
  ["read it again", "again"], ["read that again", "again"], ["read again", "again"], ["again", "again"],
  ["repeat", "again"], ["repeat that", "again"], ["say that again", "again"],
  ["pause", "pause"], ["pause reading", "pause"], ["pause playback", "pause"], ["hold on", "pause"],
  ["resume", "resume"], ["resume reading", "resume"], ["continue", "resume"], ["continue reading", "resume"], ["keep going", "resume"],
  ["start over", "restart"], ["restart", "restart"], ["from the top", "restart"], ["from the beginning", "restart"],
  ["stop", "stop"], ["stop reading", "stop"], ["be quiet", "stop"], ["quiet", "stop"],
];
const APPROVAL_WORDS = new Set([
  "approve", "approve it", "approve that", "approved", "yes", "yes do it", "yeah do it", "do it", "go ahead", "accept",
  "allow", "allow it", "ok do it", "okay do it", "sure", "yes please", "confirm", "decline", "deny", "reject", "no",
  "show approvals", "show the approvals", "pending approvals", "approvals",
]);
const INTERRUPT = new Set(["stop codex", "interrupt", "interrupt codex", "cancel the turn", "stop the turn", "stop working", "abort", "cancel that", "stop that"]);
const GOAL_GET = new Set(["whats the current goal", "whats the goal", "what is the goal", "what is the current goal", "current goal", "show the goal", "show goal", "get the goal", "read the goal", "what are we working on"]);
const GOAL_PAUSE = new Set(["pause the goal", "pause goal"]);
const GOAL_RESUME = new Set(["resume the goal", "resume goal", "unpause the goal", "continue the goal"]);
const GOAL_CLEAR = new Set(["clear the goal", "clear goal", "remove the goal", "delete the goal", "cancel the goal", "drop the goal"]);
const NEW_CHAT = new Set(["new chat", "start a new chat", "start new chat", "new conversation", "start a new conversation", "fresh chat"]);
const COPY: [string, "ask" | "phone" | "pc"][] = [
  ["copy the response", "ask"], ["copy the answer", "ask"], ["copy it", "ask"], ["copy that", "ask"], ["copy", "ask"],
  ["copy to phone", "phone"], ["copy it to my phone", "phone"], ["copy to my phone", "phone"],
  ["copy to pc", "pc"], ["copy it to my pc", "pc"], ["copy to my pc", "pc"], ["copy to computer", "pc"], ["copy to the computer", "pc"],
];
const SWITCH_VERBS = [["switch", "to"], ["go", "to"], ["change", "to"], ["jump", "to"], ["open"]];
const SKILL_LEAD = [["use", "the", "skill"], ["use", "skill"], ["invoke", "the"], ["invoke"], ["use", "the"], ["use"], ["run", "the", "skill"], ["run", "skill"]];
const TEXT_JOINERS = new Set(["to", "for", "on", "and", "then", "with"]);
/** "tell <session> to": session names are short, so don't scan the whole prompt. */
const MAX_NAME_WORDS = 5;

const clamp = (n: number) => Math.max(0, Math.min(1, n));

export function route(utterance: string, ctx: RouteContext): RouteOutput {
  const { norm } = tokenize(utterance);
  // The utterance from word i on, with its original spacing and line breaks.
  const after = (i: number) => utterance.trim().replace(new RegExp(`^(?:\\S+(?:\\s+|$)){${i}}`), "");
  const flat = norm.join(" ").replace(/\s+/g, " ").trim();
  if (!flat) return { intent: null, echo: "I didn't catch anything." };
  const sessionName = (id: string | null) => ctx.sessions.find((s) => s.id === id)?.name ?? "no session";

  // 0. "/new [first prompt]" starts a fresh chat in the active session.
  const slashNew = /^\s*\/new\b\s*([\s\S]*)$/i.exec(utterance);
  if (slashNew) {
    if (!ctx.activeSessionId) return { intent: null, echo: "No active session. Pick a session first." };
    const first = slashNew[1]!.trim();
    return {
      intent: { kind: "codex", sessionId: ctx.activeSessionId, action: { type: "thread.new", ...(first ? { text: first } : {}) }, confidence: 1, needsConfirm: false },
      echo: `Start a new chat (${sessionName(ctx.activeSessionId)})`,
    };
  }

  // 1. Approval words: never approve, only show pending approvals.
  if (APPROVAL_WORDS.has(flat)) {
    return { intent: { kind: "app", action: { type: "showApprovals" }, confidence: 1, needsConfirm: false }, echo: "Approvals need a tap. Showing pending approvals." };
  }

  // 2. Playback and copy (exact phrases only, so prompts are never swallowed).
  const playback = PLAYBACK.find(([p]) => p === flat);
  if (playback) {
    return { intent: { kind: "app", action: { type: "playback", playback: playback[1] }, confidence: 1, needsConfirm: false }, echo: `Playback: ${playback[1]}` };
  }
  const copy = COPY.find(([p]) => p === flat);
  if (copy) {
    return { intent: { kind: "app", action: { type: "copy", target: copy[1] }, confidence: 1, needsConfirm: false }, echo: copy[1] === "ask" ? "Copy to phone or PC?" : `Copy to ${copy[1] === "pc" ? "PC" : "phone"}` };
  }

  // 3. Optional session prefix for Codex commands: "in X, ..." / "for X, ...".
  let targetId = ctx.activeSessionId;
  let targetConfidence = 1;
  let start = 0;
  const prefix = matchSessionPrefix(norm, ["in", "for", "on"], ctx.sessions);
  if (prefix && prefix.match.score >= ACCEPT_THRESHOLD && prefix.rest > 1) {
    targetId = prefix.match.id;
    targetConfidence = prefix.match.score;
    start = prefix.rest;
  }
  const rest = norm.slice(start).join(" ").trim();
  const restOrig = after(start);

  // 4. Switch session.
  for (const verbs of SWITCH_VERBS) {
    if (!startsWithWords(norm, verbs) || norm.length <= verbs.length) continue;
    const spoken = norm.slice(verbs.length).join(" ").replace(/^(the )?(session |project )?/, "").replace(/ (session|project)$/, "");
    const m = bestMatch(spoken, ctx.sessions);
    if (m && m.score >= CONFIRM_THRESHOLD) {
      const needsConfirm = m.score < ACCEPT_THRESHOLD;
      return {
        intent: { kind: "app", action: { type: "switchSession", sessionId: m.id, spoken }, confidence: clamp(m.score), needsConfirm },
        echo: needsConfirm ? `Switch to ${m.name}?` : `Switch to ${m.name}`,
      };
    }
    if (verbs[0] === "switch") {
      return {
        intent: { kind: "app", action: { type: "switchSession", sessionId: null, spoken }, confidence: clamp(m?.score ?? 0), needsConfirm: true },
        echo: `No session named ${spoken}`,
      };
    }
  }

  // 5. Interrupt and goals (respect the optional session prefix).
  const needTarget = (): string | null => targetId;
  const codex = (action: Extract<Intent, { kind: "codex" }>["action"], echo: string): RouteOutput => {
    const sid = needTarget();
    if (!sid) return { intent: null, echo: "No active session. Pick a session first." };
    return { intent: { kind: "codex", sessionId: sid, action, confidence: clamp(targetConfidence), needsConfirm: false }, echo: `${echo} (${sessionName(sid)})` };
  };
  if (INTERRUPT.has(rest)) return codex({ type: "interrupt" }, "Stop the current turn");
  if (NEW_CHAT.has(rest)) return codex({ type: "thread.new" }, "Start a new chat");
  if (GOAL_GET.has(rest)) return codex({ type: "goal.get" }, "Read the goal");
  if (GOAL_PAUSE.has(rest)) return codex({ type: "goal.update", status: "paused" }, "Pause the goal");
  if (GOAL_RESUME.has(rest)) return codex({ type: "goal.update", status: "active" }, "Resume the goal");
  if (GOAL_CLEAR.has(rest)) return codex({ type: "goal.clear" }, "Clear the goal");
  const goalSet = /^(?:set|change|update|make) (?:the |my |a )?goal (?:to |as |is )?/.exec(rest);
  if (goalSet) {
    const words = goalSet[0].trim().split(" ").length;
    const objective = cleanupPrompt(after(start + words)).slice(0, MAX_GOAL_OBJECTIVE);
    if (objective) return codex({ type: "goal.set", objective }, `Set goal: ${objective}`);
  }

  // 6. Skills: "use <skill> [to <text>]".
  const lead = SKILL_LEAD.find((l) => startsWithWords(norm.slice(start), l));
  if (lead && ctx.skills.length) {
    const from = start + lead.length;
    let best: { m: Match; end: number } | null = null;
    const candidates = ctx.skills.map((s) => ({ id: s.name, name: s.name }));
    // A skill name is a few words (plus "skill"); longer spans can't match and cost O(n²) each.
    const span = Math.max(...candidates.map((c) => normalizeSpoken(c.name).split(" ").length)) + 1;
    for (let end = from + 1; end <= Math.min(norm.length, from + span); end++) {
      let spoken = norm.slice(from, end).join(" ");
      spoken = spoken.replace(/ skill$/, "");
      const m = bestMatch(spoken, candidates);
      if (m && (!best || m.score > best.m.score)) best = { m, end };
    }
    if (best && best.m.score >= CONFIRM_THRESHOLD) {
      let end = best.end;
      if (norm[end] === "skill") end++;
      while (end < norm.length && TEXT_JOINERS.has(norm[end]!)) end++;
      const text = cleanupPrompt(after(end));
      const sid = needTarget();
      if (!sid) return { intent: null, echo: "No active session. Pick a session first." };
      const needsConfirm = best.m.score < ACCEPT_THRESHOLD;
      return {
        intent: {
          kind: "codex",
          sessionId: sid,
          action: text ? { type: "skill", skill: best.m.id, text } : { type: "skill", skill: best.m.id },
          confidence: clamp(Math.min(best.m.score, targetConfidence)),
          needsConfirm,
        },
        echo: `→ ${sessionName(sid)}: $${best.m.id}${text ? " " + text : ""}`,
      };
    }
  }

  // 7. Prompts addressed to a session: "tell/ask X to ...".
  if (norm[0] === "tell" || norm[0] === "ask") {
    let best: { m: Match; split: number } | null = null;
    for (let i = 2; i < norm.length && i <= MAX_NAME_WORDS + 1; i++) {
      if (norm[i] !== "to" && norm[i] !== "that") continue;
      const m = bestMatch(norm.slice(1, i).join(" "), ctx.sessions);
      if (m && (!best || m.score > best.m.score)) best = { m, split: i };
    }
    if (best && best.m.score >= CONFIRM_THRESHOLD) {
      const text = cleanupPrompt(after(best.split + 1));
      if (text) {
        const needsConfirm = best.m.score < ACCEPT_THRESHOLD;
        return { intent: { kind: "prompt", sessionId: best.m.id, text, confidence: clamp(best.m.score), needsConfirm }, echo: `→ ${best.m.name}: ${text}` };
      }
    }
  }

  // 8. Default: a prompt for the target session, never a shell command.
  const text = cleanupPrompt(restOrig);
  const sid = targetId;
  if (!sid) return { intent: null, echo: "No active session. Pick a session first." };
  return { intent: { kind: "prompt", sessionId: sid, text, confidence: clamp(targetConfidence), needsConfirm: false }, echo: `→ ${sessionName(sid)}: ${text}` };
}

function startsWithWords(words: readonly string[], phrase: readonly string[]): boolean {
  return phrase.every((p, i) => words[i] === p);
}

/** "in kernel labs run the tests" -> match Kernel Labs, rest starts at index 3. */
function matchSessionPrefix(norm: readonly string[], leads: readonly string[], sessions: readonly Candidate[]): { match: Match; rest: number } | null {
  if (!leads.includes(norm[0] ?? "")) return null;
  let best: { match: Match; rest: number } | null = null;
  for (let end = 2; end < norm.length && end <= 5; end++) {
    const m = bestMatch(norm.slice(1, end).join(" "), sessions);
    if (m && (!best || m.score > best.match.score)) best = { match: m, rest: end };
  }
  return best;
}
