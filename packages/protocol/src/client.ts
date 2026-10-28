import {
  ALLOWED_METHODS,
  isUnsandboxedMethod,
  type NotificationMethod,
  type NotificationParams,
  type ParamsOf,
  type RequestMethod,
  type ResultOf,
  type ServerRequestMethod,
  type ServerRequestParams,
} from "./methods.js";
import type { Transport } from "./transport.js";

export type RpcId = string | number;

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export interface ClientOptions {
  /** Per-request timeout in ms (default 30 s). */
  timeoutMs?: number;
  /** Called for lines that are not valid JSON-RPC (never includes secrets; for debugging). */
  onProtocolError?: (message: string) => void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; method: string };
type AnyHandler = (method: string, params: unknown) => void;
type ServerRequestHandler = (method: string, params: unknown, id: RpcId) => Promise<unknown> | unknown;

/**
 * Transport-agnostic JSON-RPC 2.0 client for "codex app-server".
 * The "jsonrpc" field is omitted on the wire, matching app-server.
 */
export class AppServerClient {
  private nextId = 1;
  private readonly pending = new Map<RpcId, Pending>();
  private readonly handlers = new Map<string, Set<(params: unknown) => void>>();
  private readonly anyHandlers = new Set<AnyHandler>();
  private serverRequestHandler: ServerRequestHandler | null = null;
  private closedReason: string | null = null;
  private readonly closeCbs: ((reason: string) => void)[] = [];

  constructor(
    private readonly transport: Transport,
    private readonly opts: ClientOptions = {},
  ) {
    transport.onLine((line) => this.handleLine(line));
    transport.onClose((reason) => this.handleClose(reason));
  }

  get closed(): boolean {
    return this.closedReason !== null;
  }

  /** Send a request and await its result. Refuses methods outside the allowlist. */
  request<M extends RequestMethod>(method: M, params: ParamsOf<M>, timeoutMs?: number): Promise<ResultOf<M>> {
    if (!ALLOWED_METHODS.has(method) || isUnsandboxedMethod(method)) {
      return Promise.reject(new RpcError(`method not allowed by Sulti: ${method}`, -32601));
    }
    if (this.closedReason) return Promise.reject(new RpcError(`connection closed: ${this.closedReason}`, -32000));
    const id = this.nextId++;
    return new Promise<ResultOf<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(`timeout waiting for ${method}`, -32001));
      }, timeoutMs ?? this.opts.timeoutMs ?? 30_000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, method });
      this.write(params === undefined ? { method, id } : { method, id, params });
    });
  }

  /** Send a notification (no response expected). */
  notify(method: "initialized", params?: Record<string, never>): void {
    this.write({ method, params: params ?? {} });
  }

  /** Subscribe to one notification method. Returns an unsubscribe function. */
  on<M extends NotificationMethod>(method: M, handler: (params: NotificationParams<M>) => void): () => void {
    let set = this.handlers.get(method);
    if (!set) this.handlers.set(method, (set = new Set()));
    const h = handler as (p: unknown) => void;
    set.add(h);
    return () => set.delete(h);
  }

  /** Subscribe to every notification. */
  onAny(handler: AnyHandler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  /**
   * Handle server-initiated requests (approvals etc.). The handler's return
   * value becomes the result; a thrown error becomes a JSON-RPC error.
   */
  onServerRequest(handler: <M extends ServerRequestMethod>(method: M, params: ServerRequestParams<M>, id: RpcId) => Promise<unknown> | unknown): void {
    this.serverRequestHandler = handler as ServerRequestHandler;
  }

  onClose(cb: (reason: string) => void): void {
    this.closeCbs.push(cb);
  }

  /** initialize + initialized handshake. */
  async initialize(clientInfo: { name: string; title: string; version: string }, timeoutMs = 20_000): Promise<ResultOf<"initialize">> {
    const result = await this.request("initialize", { clientInfo, capabilities: null }, timeoutMs);
    this.notify("initialized");
    return result;
  }

  /** Reject everything pending and close the transport. */
  close(): void {
    this.transport.close();
    this.handleClose("closed by client");
  }

  private write(msg: object): void {
    this.transport.send(JSON.stringify(msg));
  }

  private handleLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.opts.onProtocolError?.("non-JSON line from server");
      return;
    }
    if (typeof msg !== "object" || msg === null) return;
    const hasId = typeof msg.id === "string" || typeof msg.id === "number";
    const method = typeof msg.method === "string" ? msg.method : null;

    if (hasId && method) return void this.handleServerRequest(msg.id as RpcId, method, msg.params);
    if (hasId) return this.handleResponse(msg);
    if (method) return this.dispatch(method, msg.params);
    this.opts.onProtocolError?.("unrecognised message shape");
  }

  private handleResponse(msg: Record<string, unknown>): void {
    const p = this.pending.get(msg.id as RpcId);
    if (!p) return;
    this.pending.delete(msg.id as RpcId);
    clearTimeout(p.timer);
    if (msg.error && typeof msg.error === "object") {
      const e = msg.error as { message?: string; code?: number; data?: unknown };
      p.reject(new RpcError(e.message ?? `${p.method} failed`, e.code ?? -32000, e.data));
    } else {
      p.resolve(msg.result);
    }
  }

  private dispatch(method: string, params: unknown): void {
    for (const h of this.anyHandlers) safe(() => h(method, params));
    for (const h of this.handlers.get(method) ?? []) safe(() => h(params));
  }

  private async handleServerRequest(id: RpcId, method: string, params: unknown): Promise<void> {
    if (!this.serverRequestHandler) {
      this.write({ id, error: { code: -32601, message: `no handler for ${method}` } });
      return;
    }
    try {
      const result = await this.serverRequestHandler(method, params, id);
      this.write({ id, result: result ?? {} });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.write({ id, error: { code: -32000, message } });
    }
  }

  private handleClose(reason: string): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new RpcError(`connection closed: ${reason}`, -32000));
    }
    this.pending.clear();
    for (const cb of this.closeCbs) safe(() => cb(reason));
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // A faulty handler must not break the read loop.
  }
}
