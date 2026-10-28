import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { LOOPBACK_HOST } from "@sulti/core";
import type { RunningServer } from "../server.js";
import { parseStopHookBody } from "./hook.js";

export const HOOK_SECRET_HEADER = "x-sulti-hook-secret";
const MAX_HOOK_BODY = 2 * 1024 * 1024;

export interface ControlServerDeps {
  hookSecret: string;
  onStop: (stop: { cwd: string; turnId: string | null; message: string }) => void;
  /** Creates a new pairing code; returns the pairing URL. */
  newPairing: () => { code: string; url: string };
  log?: (msg: string) => void;
}

function secretOk(req: IncomingMessage, secret: string): boolean {
  const given = req.headers[HOOK_SECRET_HEADER];
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reply(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

/**
 * Local control server (127.0.0.1:7418). Never proxied. Accepts Stop-hook
 * posts and pairing-code requests from the local CLI, both with the hook secret.
 */
export function startControlServer(d: ControlServerDeps, port: number): Promise<RunningServer> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    // Browsers always send Origin on cross-site POSTs; this endpoint is for local processes only.
    if (req.headers.origin) return reply(res, 403, { error: "forbidden" });
    if (req.method !== "POST") return reply(res, 405, { error: "POST only" });
    if (!secretOk(req, d.hookSecret)) return reply(res, 401, { error: "bad secret" });
    if (url.pathname === "/local/pair-code") return reply(res, 200, d.newPairing());
    if (url.pathname !== "/hook/stop") return reply(res, 404, { error: "not found" });
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_HOOK_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reply(res, 400, { error: "invalid json" });
      }
      const parsed = parseStopHookBody(body);
      // Answer fast: the hook is waiting on us.
      reply(res, parsed.ok ? 202 : 204);
      if (parsed.ok) {
        try {
          d.onStop({ cwd: parsed.cwd, turnId: parsed.turnId, message: parsed.message });
        } catch (err) {
          d.log?.(`hook handling failed: ${(err as Error).message}`);
        }
      }
    });
  });
  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK_HOST, () => {
      resolveStart({
        server,
        port: (server.address() as AddressInfo).port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
