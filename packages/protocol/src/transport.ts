import type { ChildProcessWithoutNullStreams } from "node:child_process";
import WebSocket from "ws";

/** A bidirectional line channel. The JSON-RPC client only needs this much. */
export interface Transport {
  send(line: string): void;
  onLine(cb: (line: string) => void): void;
  onClose(cb: (reason: string) => void): void;
  close(): void;
}

/** Splits a byte stream into newline-delimited lines (handles CRLF and partial chunks). */
export class LineSplitter {
  private buf = "";
  constructor(private readonly emit: (line: string) => void) {}
  push(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, "");
      this.buf = this.buf.slice(i + 1);
      if (line.trim()) this.emit(line);
    }
  }
}

/** Newline-delimited JSON over a child process's stdin/stdout. */
export function stdioTransport(child: ChildProcessWithoutNullStreams): Transport {
  const lineCbs: ((l: string) => void)[] = [];
  const closeCbs: ((r: string) => void)[] = [];
  let closed = false;
  const fireClose = (reason: string) => {
    if (closed) return;
    closed = true;
    for (const cb of closeCbs) cb(reason);
  };
  const splitter = new LineSplitter((l) => lineCbs.forEach((cb) => cb(l)));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c: string) => splitter.push(c));
  child.on("exit", (code, signal) => fireClose(`process exited (${signal ?? code})`));
  child.on("error", (err) => fireClose(`process error: ${err.message}`));
  child.stdin.on("error", () => fireClose("stdin closed"));
  return {
    send(line) {
      if (!closed) child.stdin.write(line + "\n");
    },
    onLine: (cb) => void lineCbs.push(cb),
    onClose: (cb) => void closeCbs.push(cb),
    close() {
      if (closed) return;
      child.stdin.end();
      // Give the server a moment to exit on EOF, then make sure it is gone.
      const t = setTimeout(() => child.kill(), 2000);
      t.unref();
    },
  };
}

export interface WebSocketTransportOptions {
  /** Capability token sent as "Authorization: Bearer <token>" in the handshake. */
  bearerToken?: string;
  /** Connect timeout in ms. */
  timeoutMs?: number;
}

/** One JSON-RPC message per WebSocket text frame. Resolves once connected. */
export function connectWebSocket(url: string, opts: WebSocketTransportOptions = {}): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.bearerToken) headers.Authorization = `Bearer ${opts.bearerToken}`;
    const ws = new WebSocket(url, { headers, handshakeTimeout: opts.timeoutMs ?? 5000 });
    const lineCbs: ((l: string) => void)[] = [];
    const closeCbs: ((r: string) => void)[] = [];
    let open = false;
    ws.on("open", () => {
      open = true;
      resolve({
        send: (line) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(line);
        },
        onLine: (cb) => void lineCbs.push(cb),
        onClose: (cb) => void closeCbs.push(cb),
        close: () => ws.close(),
      });
    });
    ws.on("message", (data) => {
      const text = data.toString();
      // Be lenient: a frame may carry one message or several JSONL lines.
      for (const line of text.split("\n")) if (line.trim()) lineCbs.forEach((cb) => cb(line));
    });
    ws.on("close", (code) => closeCbs.forEach((cb) => cb(`websocket closed (${code})`)));
    ws.on("error", (err) => {
      if (!open) reject(err);
    });
  });
}
