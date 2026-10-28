import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { APP_NAME, APP_SLUG, APP_VERSION } from "@sulti/core";
import { AppServerClient, NO_RESPONSE, connectWebSocket, stdioTransport, type V2 } from "@sulti/protocol";
import { APP_SERVER_DOWN } from "./errors.js";
import type { Session } from "./sessions.js";
import { resolveCodex, spawnResolved, type ResolvedCommand } from "./spawn.js";
import type { ThreadStore } from "./store.js";
import { TurnTracker, type TurnOutcome } from "./turns.js";

export type Logger = (msg: string) => void;

export interface ConnectionOptions {
  mode: "stdio" | "shared";
  /** Override for tests: [file, ...args]. Default: codex app-server. */
  command?: string[] | null;
  sharedUrl?: string;
  sharedTokenFile?: string;
  log?: Logger;
  /** Backoff schedule in ms. */
  backoff?: number[];
}

/**
 * One connection to an app-server: spawns "codex app-server" over stdio (or
 * connects to a shared WebSocket server), performs the handshake, and
 * reconnects with backoff when it dies.
 */
export class AppServerConnection {
  private current: AppServerClient | null = null;
  private stopped = false;
  private attempt = 0;
  private readonly upCbs: ((c: AppServerClient) => void)[] = [];
  private readonly downCbs: ((reason: string) => void)[] = [];
  private readyWaiters: ((c: AppServerClient) => void)[] = [];

  constructor(private readonly opts: ConnectionOptions) {}

  get client(): AppServerClient | null {
    return this.current && !this.current.closed ? this.current : null;
  }

  onUp(cb: (c: AppServerClient) => void): void {
    this.upCbs.push(cb);
  }
  onDown(cb: (reason: string) => void): void {
    this.downCbs.push(cb);
  }

  /** Resolves with a ready client (waits for a reconnect if needed). */
  ready(timeoutMs = 30_000): Promise<AppServerClient> {
    const c = this.client;
    if (c) return Promise.resolve(c);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(APP_SERVER_DOWN)), timeoutMs);
      this.readyWaiters.push((cl) => {
        clearTimeout(t);
        resolve(cl);
      });
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.current?.close();
    this.current = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const log = this.opts.log ?? (() => {});
    try {
      const client = this.opts.mode === "shared" ? await this.connectShared() : this.spawnStdio();
      client.onClose((reason) => {
        if (this.current === client) this.current = null;
        log(`app-server connection closed: ${reason}`);
        for (const cb of this.downCbs) cb(reason);
        this.scheduleReconnect();
      });
      await client.initialize({ name: APP_SLUG, title: APP_NAME, version: APP_VERSION });
      this.current = client;
      this.attempt = 0;
      log(`app-server ready (${this.opts.mode})`);
      for (const cb of this.upCbs) cb(client);
      const waiters = this.readyWaiters;
      this.readyWaiters = [];
      for (const w of waiters) w(client);
    } catch (err) {
      log(`app-server start failed: ${(err as Error).message}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const schedule = this.opts.backoff ?? [1000, 2000, 4000, 8000, 15000, 30000];
    const delay = schedule[Math.min(this.attempt, schedule.length - 1)]!;
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private spawnStdio(): AppServerClient {
    let cmd: ResolvedCommand;
    let args: string[];
    if (this.opts.command?.length) {
      const [file, ...rest] = this.opts.command;
      const ext = extname(file!).toLowerCase();
      cmd = { file: file!, kind: ext === ".cmd" || ext === ".bat" ? "cmd" : ext === ".exe" ? "exe" : "other" };
      args = rest;
    } else {
      cmd = resolveCodex();
      // stdio is the default transport; Sulti never opens a network listener here.
      args = ["app-server"];
    }
    const child = spawnResolved(cmd, args);
    child.stderr.resume(); // drain; app-server logs can contain local details, so don't persist them
    return new AppServerClient(stdioTransport(child), { timeoutMs: 60_000 });
  }

  private async connectShared(): Promise<AppServerClient> {
    const url = this.opts.sharedUrl ?? "ws://127.0.0.1:4500";
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") throw new Error("Shared app-server must be on loopback");
    const token = this.opts.sharedTokenFile ? readFileSync(this.opts.sharedTokenFile, "utf8").trim() : undefined;
    const transport = await connectWebSocket(url, token ? { bearerToken: token } : {});
    return new AppServerClient(transport, { timeoutMs: 60_000 });
  }
}

export interface PendingApproval {
  requestId: string;
  rpcId: string | number;
  threadId: string;
  turnId: string;
  sessionId: string;
  kind: "command" | "fileChange";
  summary: string;
  command?: string;
  cwd?: string;
  resolve: (v: unknown) => void;
}

export interface BridgeEvents {
  status(sessionId: string, status: "idle" | "working" | "waitingApproval" | "error"): void;
  outcome(sessionId: string, outcome: TurnOutcome): void;
  approvalRequest(a: PendingApproval): void;
  approvalResolved(requestId: string): void;
  goal(sessionId: string, goal: V2.ThreadGoal | null): void;
  delta(sessionId: string, turnId: string): void;
  toast(level: "info" | "warn" | "error", message: string): void;
}

/** Text input item; app-server requires text_elements. */
export const textInput = (text: string): V2.UserInput => ({ type: "text", text, text_elements: [] });

/**
 * Maps Sulti sessions onto app-server threads and turns, and app-server
 * events back onto sessions.
 */
export class CodexBridge {
  private readonly tracker = new TurnTracker();
  private readonly threadToSession = new Map<string, string>();
  private readonly loaded = new Set<string>();
  private readonly activeTurn = new Map<string, string>(); // threadId -> turnId
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly fileChanges = new Map<string, string[]>(); // itemId -> paths
  private readonly skillCache = new Map<string, V2.SkillMetadata[]>();
  private seq = 0;

  constructor(
    private readonly conn: AppServerConnection,
    private readonly threads: ThreadStore,
    private readonly events: BridgeEvents,
    private readonly log: Logger = () => {},
  ) {
    for (const [sid, tid] of Object.entries(threads.all())) this.threadToSession.set(tid, sid);
    conn.onUp((client) => this.attach(client));
    conn.onDown(() => {
      // A new process has none of our threads loaded; resume lazily or on reconnect.
      this.loaded.clear();
      for (const [threadId] of this.activeTurn) {
        const sid = this.threadToSession.get(threadId);
        if (sid) this.events.status(sid, "error");
      }
      this.activeTurn.clear();
      for (const a of this.approvals.values()) {
        this.events.approvalResolved(a.requestId);
        a.resolve(NO_RESPONSE);
      }
      this.approvals.clear();
      this.events.toast("warn", APP_SERVER_DOWN);
    });
  }

  /** Resume every known thread after a (re)connect so events flow again. */
  async resumeKnown(sessions: Session[]): Promise<void> {
    for (const s of sessions) {
      if (s.unlisted || !this.threads.get(s.id)) continue;
      try {
        await this.ensureThread(s);
      } catch (err) {
        this.log(`resume failed for ${s.id}: ${(err as Error).message}`);
      }
    }
  }

  sessionForThread(threadId: string): string | undefined {
    return this.threadToSession.get(threadId);
  }

  pendingApprovals(): PendingApproval[] {
    return [...this.approvals.values()];
  }

  isBusy(sessionId: string): boolean {
    const tid = this.threads.get(sessionId);
    return !!tid && this.activeTurn.has(tid);
  }

  async ensureThread(s: Session): Promise<string> {
    const client = await this.conn.ready();
    const known = this.threads.get(s.id);
    if (known && this.loaded.has(known)) return known;
    const policy = { cwd: s.cwd, sandbox: s.sandbox, approvalPolicy: s.approvalPolicy } as const;
    if (known) {
      try {
        await client.request("thread/resume", { threadId: known, ...policy, excludeTurns: true });
        this.bind(s.id, known);
        return known;
      } catch (err) {
        this.log(`thread/resume failed for ${s.id}, starting a new thread: ${(err as Error).message}`);
      }
    }
    const res = await client.request("thread/start", policy);
    this.threads.set(s.id, res.thread.id);
    this.bind(s.id, res.thread.id);
    return res.thread.id;
  }

  /** Attach a session to an existing thread (from thread/list). */
  async attachThread(s: Session, threadId: string): Promise<void> {
    const client = await this.conn.ready();
    await client.request("thread/resume", { threadId, cwd: s.cwd, sandbox: s.sandbox, approvalPolicy: s.approvalPolicy, excludeTurns: true });
    const old = this.threads.get(s.id);
    if (old) this.threadToSession.delete(old);
    this.threads.set(s.id, threadId);
    this.bind(s.id, threadId);
  }

  async listThreads(s: Session): Promise<V2.Thread[]> {
    const client = await this.conn.ready();
    const res = await client.request("thread/list", { cwd: s.cwd, limit: 20 });
    return res.data;
  }

  async startTurn(s: Session, input: V2.UserInput[]): Promise<string> {
    const threadId = await this.ensureThread(s);
    const client = await this.conn.ready();
    const res = await client.request("turn/start", { threadId, input });
    this.activeTurn.set(threadId, res.turn.id);
    this.events.status(s.id, "working");
    return res.turn.id;
  }

  sendPrompt(s: Session, text: string): Promise<string> {
    return this.startTurn(s, [textInput(text)]);
  }

  async skills(s: Session, force = false): Promise<V2.SkillMetadata[]> {
    if (!force && this.skillCache.has(s.id)) return this.skillCache.get(s.id)!;
    const client = await this.conn.ready();
    const res = await client.request("skills/list", { cwds: [s.cwd] });
    const skills = (res.data[0]?.skills ?? []).filter((k) => k.enabled !== false);
    this.skillCache.set(s.id, skills);
    return skills;
  }

  /** Explicit skill invocation: "$name" in the text plus a skill input item. */
  async invokeSkill(s: Session, skillName: string, text?: string): Promise<string> {
    const skill = (await this.skills(s)).find((k) => k.name === skillName);
    if (!skill) throw new Error(`No skill named ${skillName} in ${s.name}.`);
    const body = `$${skill.name}${text ? " " + text : ""}`;
    return this.startTurn(s, [textInput(body), { type: "skill", name: skill.name, path: skill.path }]);
  }

  async interrupt(s: Session): Promise<boolean> {
    const threadId = this.threads.get(s.id);
    const turnId = threadId ? this.activeTurn.get(threadId) : undefined;
    if (!threadId || !turnId) return false;
    const client = await this.conn.ready();
    await client.request("turn/interrupt", { threadId, turnId });
    return true;
  }

  async getGoal(s: Session): Promise<V2.ThreadGoal | null> {
    const threadId = await this.ensureThread(s);
    const client = await this.conn.ready();
    return (await client.request("thread/goal/get", { threadId })).goal;
  }

  async setGoal(s: Session, objective: string): Promise<V2.ThreadGoal> {
    const threadId = await this.ensureThread(s);
    const client = await this.conn.ready();
    return (await client.request("thread/goal/set", { threadId, objective, status: "active", origin: "user" })).goal;
  }

  async updateGoal(s: Session, status: "active" | "paused"): Promise<V2.ThreadGoal> {
    const threadId = await this.ensureThread(s);
    const client = await this.conn.ready();
    return (await client.request("thread/goal/set", { threadId, status, origin: "user" })).goal;
  }

  async clearGoal(s: Session): Promise<boolean> {
    const threadId = await this.ensureThread(s);
    const client = await this.conn.ready();
    return (await client.request("thread/goal/clear", { threadId, origin: "user" })).cleared;
  }

  /** Answer a pending approval. Only ever called from an explicit phone tap. */
  respondApproval(requestId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel"): boolean {
    const a = this.approvals.get(requestId);
    if (!a) return false;
    this.approvals.delete(requestId);
    a.resolve({ decision });
    this.events.approvalResolved(requestId);
    this.refreshStatus(a.sessionId);
    return true;
  }

  private bind(sessionId: string, threadId: string): void {
    this.threadToSession.set(threadId, sessionId);
    this.loaded.add(threadId);
  }

  private refreshStatus(sessionId: string): void {
    const waiting = [...this.approvals.values()].some((a) => a.sessionId === sessionId);
    if (waiting) return this.events.status(sessionId, "waitingApproval");
    this.events.status(sessionId, this.isBusy(sessionId) ? "working" : "idle");
  }

  private attach(client: AppServerClient): void {
    client.onAny((method, params) => this.onNotification(method, params));
    client.onServerRequest((method, params, rpcId) => this.onServerRequest(method, params, rpcId));
  }

  private onNotification(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    const threadId = typeof p.threadId === "string" ? p.threadId : null;
    const sid = threadId ? this.threadToSession.get(threadId) : undefined;
    switch (method) {
      case "turn/started": {
        const turnId = (p.turn as { id?: string } | undefined)?.id;
        if (threadId && turnId) this.activeTurn.set(threadId, turnId);
        if (sid) this.events.status(sid, "working");
        break;
      }
      case "item/started": {
        const item = p.item as { type?: string; id?: string; changes?: { path?: string }[] } | undefined;
        if (item?.type === "fileChange" && item.id) this.fileChanges.set(item.id, (item.changes ?? []).map((c) => String(c.path ?? "")).filter(Boolean));
        break;
      }
      case "item/agentMessage/delta":
        if (sid && typeof p.turnId === "string") this.events.delta(sid, p.turnId);
        break;
      case "serverRequest/resolved": {
        const rpcId = p.requestId as string | number | undefined;
        for (const a of this.approvals.values()) {
          if (a.rpcId !== rpcId) continue;
          this.approvals.delete(a.requestId);
          a.resolve(NO_RESPONSE);
          this.events.approvalResolved(a.requestId);
          this.refreshStatus(a.sessionId);
        }
        break;
      }
      case "thread/goal/updated":
        if (sid) this.events.goal(sid, (p.goal as V2.ThreadGoal) ?? null);
        break;
      case "thread/goal/cleared":
        if (sid) this.events.goal(sid, null);
        break;
      default:
        break;
    }
    const outcome = this.tracker.feed(method, params);
    if (outcome) {
      if (threadId) this.activeTurn.delete(threadId);
      // Approvals for a finished turn can no longer be answered.
      for (const a of [...this.approvals.values()]) {
        if (a.turnId !== outcome.turnId) continue;
        this.approvals.delete(a.requestId);
        a.resolve(NO_RESPONSE);
        this.events.approvalResolved(a.requestId);
      }
      if (sid) {
        this.events.status(sid, outcome.kind === "failed" ? "error" : "idle");
        this.events.outcome(sid, outcome);
      }
    }
  }

  private onServerRequest(method: string, params: unknown, rpcId: string | number): unknown {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method !== "item/commandExecution/requestApproval" && method !== "item/fileChange/requestApproval") {
      // Not supported from the phone. Never approve by default.
      throw new Error(`${method} is not supported by Sulti`);
    }
    const threadId = String(p.threadId ?? "");
    const sessionId = this.threadToSession.get(threadId);
    // In shared mode another client (the TUI) may own this thread; let it answer.
    if (!sessionId) return NO_RESPONSE;
    const kind = method === "item/commandExecution/requestApproval" ? "command" : "fileChange";
    const reason = typeof p.reason === "string" && p.reason ? p.reason : null;
    let summary: string;
    let command: string | undefined;
    if (kind === "command") {
      command = typeof p.command === "string" ? p.command : undefined;
      summary = command ? `Run: ${command}` : "Run a command";
    } else {
      const files = this.fileChanges.get(String(p.itemId ?? "")) ?? [];
      const names = files.map((f) => f.split(/[\\/]/).slice(-2).join("/"));
      summary = files.length ? `Edit ${files.length} file${files.length === 1 ? "" : "s"}: ${names.slice(0, 5).join(", ")}${files.length > 5 ? ", …" : ""}` : "Apply file changes";
      if (typeof p.grantRoot === "string" && p.grantRoot) summary += `, and allow writes under ${p.grantRoot}`;
    }
    if (reason) summary += `. ${reason}`;
    return new Promise((resolve) => {
      const a: PendingApproval = {
        requestId: `appr-${Date.now().toString(36)}-${++this.seq}`,
        rpcId,
        threadId,
        turnId: String(p.turnId ?? ""),
        sessionId,
        kind,
        summary,
        ...(command ? { command } : {}),
        ...(typeof p.cwd === "string" ? { cwd: p.cwd } : {}),
        resolve,
      };
      this.approvals.set(a.requestId, a);
      this.events.approvalRequest(a);
      this.events.status(sessionId, "waitingApproval");
    });
  }
}
