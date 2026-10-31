import { randomBytes } from "node:crypto";
import { route, type ActivityItem, type CompanionMessage, type Goal, type Intent, type PhoneMessage, toSpeechText } from "@sulti/core";
import type { V2 } from "@sulti/protocol";
import { upsertActivity } from "./activity.js";
import { MAX_ANSWERS, type AnswerStore } from "./answers.js";
import { CodexBridge, type PendingApproval } from "./appserver.js";
import type { Pairing, PairRequestInfo } from "./pairing.js";
import type { Session, SessionRegistry } from "./sessions.js";
import { signedAudioPath } from "./signing.js";
import type { ThreadStore } from "./store.js";
import type { TurnOutcome } from "./turns.js";

export interface PhoneClient {
  deviceId: string;
  send(msg: CompanionMessage): void;
}

export interface HubDeps {
  registry: SessionRegistry;
  answers: AnswerStore;
  threads: ThreadStore;
  pairing: Pairing;
  signingSecret: string;
  /** Renders speech text to a WAV at outFile. */
  renderAudio: (speechText: string, outFile: string) => Promise<void>;
  copyToPc: (text: string) => Promise<void>;
  log?: (msg: string) => void;
}

const ROUTE_TTL_MS = 2 * 60 * 1000;

function toGoal(g: V2.ThreadGoal | null): Goal | null {
  if (!g) return null;
  return { objective: g.objective, status: g.status, tokenBudget: g.tokenBudget, tokensUsed: g.tokensUsed, timeUsedSeconds: g.timeUsedSeconds, updatedAt: g.updatedAt };
}

/** Routes phone messages to Codex and broadcasts Codex events to phones. */
export class Hub {
  bridge!: CodexBridge;
  activeSessionId: string | null;
  private readonly clients = new Set<PhoneClient>();
  private readonly pendingRoutes = new Map<string, { intent: Intent; expires: number }>();
  private readonly renders = new Map<string, Promise<void>>();
  /** Latest "right now" lines per session, cleared when a new turn starts. */
  private readonly activity = new Map<string, ActivityItem[]>();

  constructor(private readonly d: HubDeps) {
    this.activeSessionId = d.registry.list().find((s) => !s.unlisted)?.id ?? null;
  }

  /** Callbacks for CodexBridge. */
  bridgeEvents() {
    return {
      status: (sid: string, status: "idle" | "working" | "waitingApproval" | "error") => {
        const prev = this.d.registry.getStatus(sid);
        if (!this.d.registry.setStatus(sid, status)) return;
        if (status === "working" && (prev === "idle" || prev === "error") && this.activity.delete(sid)) {
          this.broadcast({ type: "activity", sessionId: sid, items: [] });
        }
        this.broadcast({ type: "session.status", sessionId: sid, status, since: this.d.registry.since(sid) ?? Date.now() });
      },
      outcome: (sid: string, o: TurnOutcome) => this.onOutcome(sid, o),
      thread: () => this.broadcast(this.sessionsMsg()),
      approvalRequest: (a: PendingApproval) => this.broadcast(this.approvalMsg(a)),
      approvalResolved: (requestId: string) => this.broadcast({ type: "approval.resolved", requestId }),
      activity: (sid: string, item: ActivityItem) => {
        const items = upsertActivity(this.activity.get(sid) ?? [], item);
        this.activity.set(sid, items);
        this.broadcast({ type: "activity", sessionId: sid, items });
      },
      goal: (sid: string, goal: V2.ThreadGoal | null) => this.broadcast({ type: "goal", sessionId: sid, goal: toGoal(goal) }),
      delta: () => {},
      toast: (level: "info" | "warn" | "error", message: string) => this.broadcast({ type: "toast", level, message }),
    };
  }

  addClient(c: PhoneClient): () => void {
    this.clients.add(c);
    return () => this.clients.delete(c);
  }

  broadcast(msg: CompanionMessage): void {
    for (const c of this.clients) c.send(msg);
  }

  /** Ask every open phone to let a new device in. Returns how many phones were asked. */
  askToPair(info: PairRequestInfo): number {
    this.broadcast({ type: "pair.request", ...info });
    return this.clients.size;
  }

  /** Initial state for a freshly authenticated phone. */
  async welcome(c: PhoneClient): Promise<void> {
    c.send(this.sessionsMsg());
    // The 20 newest, plus each session's latest so a quiet session still shows its answer.
    const latest = new Map(this.d.answers.recent(MAX_ANSWERS).map((a) => [a.sessionId, a]));
    const backlog = new Set([...this.d.answers.recent(20), ...latest.values()]);
    for (const a of [...backlog].sort((x, y) => x.createdAt - y.createdAt)) c.send({ type: "answer", ...a });
    for (const a of this.bridge.pendingApprovals()) c.send(this.approvalMsg(a));
    for (const p of this.d.pairing.pendingRequests()) c.send({ type: "pair.request", ...p });
    for (const [sessionId, items] of this.activity) c.send({ type: "activity", sessionId, items });
    if (this.activeSessionId) await this.sendSessionDetails(c, this.activeSessionId);
  }

  /** Store and broadcast an answer that arrived through the Stop hook. */
  onHookAnswer(input: { cwd: string; sessionId?: string | null; turnId: string | null; message: string }): void {
    // The Stop hook is global, so it also fires for turns Sulti runs itself, often before the
    // app-server reports them. Keep that copy (in case the app-server never does), filed under
    // Sulti's session as an app-server answer instead of "from a terminal".
    const own = input.turnId ? this.bridge.sessionForTurn(input.turnId) : undefined;
    if (own) {
      const answer = this.d.answers.add({ sessionId: own, turnId: input.turnId!, text: input.message, source: "appServer" });
      if (answer) this.broadcast({ type: "answer", ...answer });
      return;
    }
    const s = this.d.registry.forHookCwd(input.cwd);
    const isNew = !this.sessionsKnown.has(s.id);
    this.sessionsKnown.add(s.id);
    const answer = this.d.answers.add({ sessionId: s.id, turnId: input.turnId ?? "", text: input.message, source: "hook" });
    if (isNew && s.unlisted) this.broadcast(this.sessionsMsg());
    if (answer) this.broadcast({ type: "answer", ...answer });
  }
  private readonly sessionsKnown = new Set<string>();

  async handle(c: PhoneClient, msg: PhoneMessage): Promise<void> {
    try {
      await this.dispatch(c, msg);
    } catch (err) {
      c.send({ type: "toast", level: "error", message: (err as Error).message || "Something went wrong." });
    }
  }

  private async dispatch(c: PhoneClient, msg: PhoneMessage): Promise<void> {
    switch (msg.type) {
      case "auth":
        return; // handled by the server
      case "sessions.list":
        return c.send(this.sessionsMsg());
      case "session.select":
        return this.select(this.session(msg.sessionId).id, c);
      case "utterance":
        return this.onUtterance(c, msg.text, msg.sessionId);
      case "route.confirm": {
        const pending = this.pendingRoutes.get(msg.routeId);
        this.pendingRoutes.delete(msg.routeId);
        if (!pending || pending.expires < Date.now()) return c.send({ type: "toast", level: "warn", message: "That request expired. Say it again." });
        if (!msg.accept) return c.send({ type: "toast", level: "info", message: "Cancelled." });
        return this.execute(c, pending.intent, true);
      }
      case "prompt.send":
        return this.prompt(c, msg.sessionId, msg.text);
      case "skill.invoke": {
        const s = this.promptable(msg.sessionId);
        await this.bridge.invokeSkill(s, msg.skill, msg.text);
        return c.send({ type: "toast", level: "info", message: `Sent $${msg.skill} to ${s.name}.` });
      }
      case "goal.get": {
        const s = this.promptable(msg.sessionId);
        return c.send({ type: "goal", sessionId: s.id, goal: toGoal(await this.bridge.getGoal(s)) });
      }
      case "goal.set": {
        const s = this.promptable(msg.sessionId);
        return this.broadcast({ type: "goal", sessionId: s.id, goal: toGoal(await this.bridge.setGoal(s, msg.objective)) });
      }
      case "goal.update": {
        const s = this.promptable(msg.sessionId);
        return this.broadcast({ type: "goal", sessionId: s.id, goal: toGoal(await this.bridge.updateGoal(s, msg.status)) });
      }
      case "goal.clear": {
        const s = this.promptable(msg.sessionId);
        await this.bridge.clearGoal(s);
        return this.broadcast({ type: "goal", sessionId: s.id, goal: null });
      }
      case "turn.interrupt": {
        const s = this.session(msg.sessionId);
        const ok = !s.unlisted && (await this.bridge.interrupt(s));
        return c.send({ type: "toast", level: ok ? "info" : "warn", message: ok ? `Stopping ${s.name}.` : `${s.name} has no running turn.` });
      }
      case "approval.respond": {
        // The only path that answers an approval: an explicit tap on the phone.
        const ok = this.bridge.respondApproval(msg.requestId, msg.decision);
        if (!ok) c.send({ type: "toast", level: "warn", message: "That approval is no longer pending." });
        return;
      }
      case "answer.copyToPc": {
        const a = this.d.answers.get(msg.answerId);
        if (!a) throw new Error("That answer is gone.");
        await this.d.copyToPc(a.text);
        return c.send({ type: "toast", level: "info", message: "Copied to the PC clipboard." });
      }
      case "answer.audioUrl":
        return this.audioUrl(c, msg.answerId);
      case "thread.list": {
        const s = this.promptable(msg.sessionId);
        const threads = await this.bridge.listThreads(s);
        return c.send({
          type: "threads",
          sessionId: s.id,
          threads: threads.map((t) => ({ id: t.id, preview: t.preview.slice(0, 200), name: t.name, updatedAt: t.updatedAt })),
        });
      }
      case "thread.attach": {
        const s = this.promptable(msg.sessionId);
        if (this.bridge.isBusy(s.id)) throw new Error(`${s.name} is still working. Stop the turn first.`);
        await this.bridge.attachThread(s, msg.threadId);
        this.broadcast({ type: "goal", sessionId: s.id, goal: toGoal(await this.bridge.getGoal(s)) });
        return;
      }
      case "thread.new":
        return this.newChat(c, this.promptable(msg.sessionId));
      case "pair.respond": {
        // Like approvals, only an explicit tap on a paired phone lets a new device in.
        const ok = this.d.pairing.respond(msg.requestId, msg.accept);
        this.broadcast({ type: "pair.resolved", requestId: msg.requestId });
        if (ok) this.d.log?.(`device ${c.deviceId} ${msg.accept ? "allowed" : "denied"} pairing request ${msg.requestId}`);
        if (!ok) return c.send({ type: "toast", level: "warn", message: "That request expired. Ask again on the new device." });
        return c.send({ type: "toast", level: "info", message: msg.accept ? "Allowed. The new device is connecting." : "Denied." });
      }
    }
  }

  private async newChat(c: PhoneClient, s: Session, first?: string): Promise<void> {
    await this.bridge.newThread(s);
    this.broadcast(this.sessionsMsg());
    this.broadcast({ type: "goal", sessionId: s.id, goal: null });
    if (first) return this.prompt(c, s.id, first);
    c.send({ type: "toast", level: "info", message: `New chat in ${s.name}. Your next message starts it.` });
  }

  private async onUtterance(c: PhoneClient, text: string, sessionId?: string): Promise<void> {
    const active = sessionId && this.d.registry.get(sessionId) ? sessionId : this.activeSessionId;
    const activeSession = active ? this.d.registry.get(active) : undefined;
    const skills = activeSession && !activeSession.unlisted ? await this.bridge.skills(activeSession).catch(() => []) : [];
    const out = route(text, {
      sessions: this.d.registry.list().filter((s) => !s.unlisted),
      skills,
      activeSessionId: active ?? null,
    });
    if (!out.intent) return c.send({ type: "toast", level: "warn", message: out.echo });
    const routeId = randomBytes(8).toString("hex");
    c.send({ type: "route.result", routeId, intent: out.intent, echo: out.echo, needsConfirm: out.intent.needsConfirm });
    if (out.intent.needsConfirm) {
      // Only remember routes that can actually be executed after a confirm.
      const sw = out.intent.kind === "app" && out.intent.action.type === "switchSession" && !out.intent.action.sessionId;
      if (!sw) this.pendingRoutes.set(routeId, { intent: out.intent, expires: Date.now() + ROUTE_TTL_MS });
      return;
    }
    await this.execute(c, out.intent, false);
  }

  /** Run a routed intent. App intents other than switching are handled on the phone. */
  private async execute(c: PhoneClient, intent: Intent, confirmed: boolean): Promise<void> {
    if (intent.kind === "app") {
      if (intent.action.type === "switchSession" && intent.action.sessionId) await this.select(intent.action.sessionId, c);
      return;
    }
    if (intent.kind === "prompt") return this.prompt(c, intent.sessionId, intent.text);
    const s = this.promptable(intent.sessionId);
    const a = intent.action;
    switch (a.type) {
      case "skill":
        await this.bridge.invokeSkill(s, a.skill, a.text);
        return;
      case "interrupt":
        return this.dispatch(c, { type: "turn.interrupt", sessionId: s.id });
      case "thread.new":
        return this.newChat(c, s, a.text);
      case "goal.get":
        return this.dispatch(c, { type: "goal.get", sessionId: s.id });
      case "goal.set":
        return this.dispatch(c, { type: "goal.set", sessionId: s.id, objective: a.objective });
      case "goal.update":
        return this.dispatch(c, { type: "goal.update", sessionId: s.id, status: a.status });
      case "goal.clear":
        return this.dispatch(c, { type: "goal.clear", sessionId: s.id });
    }
    void confirmed;
  }

  private async prompt(_c: PhoneClient, sessionId: string, text: string): Promise<void> {
    const s = this.promptable(sessionId);
    // Always a Codex prompt. Sulti never runs shell commands itself.
    await this.bridge.sendPrompt(s, text);
  }

  private async select(sessionId: string, c: PhoneClient): Promise<void> {
    this.activeSessionId = sessionId;
    this.broadcast(this.sessionsMsg());
    await this.sendSessionDetails(c, sessionId);
  }

  private async sendSessionDetails(c: PhoneClient, sessionId: string): Promise<void> {
    const s = this.d.registry.get(sessionId);
    if (!s || s.unlisted) return;
    try {
      const skills = await this.bridge.skills(s);
      c.send({ type: "skills", sessionId: s.id, skills: skills.map((k) => ({ name: k.name, description: k.shortDescription ?? k.description ?? "", path: k.path })) });
      // Don't create a thread just because the phone looked at a session.
      if (this.d.threads.get(s.id)) c.send({ type: "goal", sessionId: s.id, goal: toGoal(await this.bridge.getGoal(s)) });
      else c.send({ type: "goal", sessionId: s.id, goal: null });
    } catch (err) {
      this.d.log?.(`session details failed for ${s.id}: ${(err as Error).message}`);
    }
  }

  private async audioUrl(c: PhoneClient, answerId: string): Promise<void> {
    const a = this.d.answers.get(answerId);
    if (!a) throw new Error("That answer is gone.");
    if (!this.d.answers.hasAudio(a.id)) {
      let job = this.renders.get(a.id);
      if (!job) {
        job = this.d.renderAudio(a.speechText || toSpeechText(a.text), this.d.answers.audioPath(a.id)).finally(() => this.renders.delete(a.id));
        this.renders.set(a.id, job);
      }
      try {
        await job;
      } catch (err) {
        this.d.log?.(`audio render failed for ${a.id}: ${(err as Error).message}`);
        return c.send({ type: "audio.failed", answerId: a.id, message: "Your PC couldn't read this answer aloud. Try the phone voice." });
      }
    }
    c.send({ type: "audio.url", answerId: a.id, url: signedAudioPath(this.d.signingSecret, a.id) });
  }

  private onOutcome(sid: string, o: TurnOutcome): void {
    if (o.kind === "answer") {
      const answer = this.d.answers.add({ sessionId: sid, turnId: o.turnId, text: o.text, source: "appServer" });
      if (answer) this.broadcast({ type: "answer", ...answer });
    } else if (o.kind === "failed") {
      this.broadcast({ type: "toast", level: "error", message: `${this.d.registry.get(sid)?.name ?? "Codex"}: ${o.message}` });
    } else if (o.kind === "interrupted") {
      this.broadcast({ type: "toast", level: "info", message: `${this.d.registry.get(sid)?.name ?? "Codex"} stopped.` });
    }
  }

  private session(id: string): Session {
    const s = this.d.registry.get(id);
    if (!s) throw new Error(`No session named ${id}.`);
    return s;
  }

  /** Sessions that can receive prompts: configured ones only. */
  private promptable(id: string): Session {
    const s = this.session(id);
    if (s.unlisted) throw new Error(`${s.name} isn't in sessions.json yet, so Sulti can only listen to it.`);
    return s;
  }

  sessionsMsg(): CompanionMessage {
    const sessions = this.d.registry
      .list()
      .map((s) => this.d.registry.info(s.id, this.d.threads.get(s.id)))
      .filter((x): x is NonNullable<typeof x> => !!x);
    return { type: "sessions", sessions, activeSessionId: this.activeSessionId };
  }

  private approvalMsg(a: PendingApproval): CompanionMessage {
    return {
      type: "approval.request",
      requestId: a.requestId,
      sessionId: a.sessionId,
      kind: a.kind,
      summary: a.summary,
      ...(a.reason ? { reason: a.reason } : {}),
      ...(a.command ? { command: a.command } : {}),
      ...(a.cwd ? { cwd: a.cwd } : {}),
    };
  }
}
