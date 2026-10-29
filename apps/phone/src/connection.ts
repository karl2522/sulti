import { parseCompanionMessage, type CompanionMessage, type PhoneMessage } from "@sulti/core";

export type ConnStatus = "connecting" | "open" | "offline";

export interface ConnectionHandlers {
  onMessage(msg: CompanionMessage): void;
  onStatus(status: ConnStatus): void;
  /** The companion closed with 4401: the token is unknown or revoked. */
  onAuthRejected(): void;
}

const AUTH_REJECTED = 4401;
const MAX_BACKOFF_MS = 15_000;

export function defaultWsUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws`;
}

/** One authenticated WebSocket to the companion, reconnecting with backoff. */
export class Connection {
  private ws: WebSocket | null = null;
  private authed = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly token: string,
    private readonly h: ConnectionHandlers,
    private readonly url = defaultWsUrl(),
  ) {}

  start(): void {
    this.stopped = false;
    window.addEventListener("online", this.reconnectNow);
    document.addEventListener("visibilitychange", this.onVisible);
    this.open();
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("online", this.reconnectNow);
    document.removeEventListener("visibilitychange", this.onVisible);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close(1000);
    this.ws = null;
  }

  get ready(): boolean {
    return this.authed && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Returns false when offline, so the caller can tell the user. */
  send(msg: PhoneMessage): boolean {
    if (!this.ready) return false;
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  private open(): void {
    if (this.stopped) return;
    this.h.onStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", deviceToken: this.token } satisfies PhoneMessage));
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const msg = parseCompanionMessage(e.data);
      if (!msg) return;
      if (msg.type === "auth.ok") {
        this.authed = true;
        this.attempt = 0;
        this.h.onStatus("open");
      }
      this.h.onMessage(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.authed = false;
      if (this.stopped) return;
      if (e.code === AUTH_REJECTED && e.reason !== "auth timeout") {
        this.stopped = true;
        this.h.onAuthRejected();
        return;
      }
      this.h.onStatus("offline");
      this.schedule();
    };
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, base / 2 + Math.random() * (base / 2));
  }

  private readonly reconnectNow = (): void => {
    if (this.stopped || this.ws) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.attempt = 0;
    this.open();
  };

  private readonly onVisible = (): void => {
    if (document.visibilityState === "visible") this.reconnectNow();
  };
}
