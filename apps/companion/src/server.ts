import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { hostname } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { APP_NAME, APP_VERSION, LOOPBACK_HOST, parsePhoneMessage, type CompanionMessage } from "@sulti/core";
import type { AnswerStore } from "./answers.js";
import type { Hub, PhoneClient } from "./hub.js";
import type { Pairing } from "./pairing.js";
import { verifyAudioSignature } from "./signing.js";

export const AUTH_TIMEOUT_MS = 5000;
const MAX_BODY = 16 * 1024;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

export interface PhoneServerDeps {
  hub: Hub;
  pairing: Pairing;
  answers: AnswerStore;
  signingSecret: string;
  publicUrl: () => string | null;
  dev: boolean;
  staticDir: string | null;
  log?: (msg: string) => void;
}

export interface RunningServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

function securityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=()");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Origins allowed to use the API and WebSocket. */
export function allowedOrigins(publicUrl: string | null, port: number, dev: boolean): Set<string> {
  const set = new Set<string>([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (publicUrl) set.add(new URL(publicUrl).origin);
  if (dev) {
    set.add("http://localhost:5173");
    set.add("http://127.0.0.1:5173");
  }
  return set;
}

/** Serve a file with HTTP Range support (iOS Safari requires it for <audio>). */
function serveFile(req: IncomingMessage, res: ServerResponse, file: string, cache: string): void {
  const size = statSync(file).size;
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range) : null;
  const headers: Record<string, string | number> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": cache };
  if (range) {
    let start = range[1] ? Number(range[1]) : NaN;
    let end = range[2] ? Number(range[2]) : NaN;
    if (Number.isNaN(start)) {
      start = Math.max(0, size - (Number.isNaN(end) ? 0 : end));
      end = size - 1;
    } else if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      return void res.end();
    }
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return void res.end();
    return void createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "Content-Length": size });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).pipe(res);
}

export function startPhoneServer(d: PhoneServerDeps, port: number): Promise<RunningServer> {
  let actualPort = port;
  const origins = () => allowedOrigins(d.publicUrl(), actualPort, d.dev);
  const originOk = (req: IncomingMessage) => typeof req.headers.origin === "string" && origins().has(req.headers.origin);

  const server = createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/api/health" && req.method === "GET") return sendJson(res, 200, { ok: true, app: APP_NAME, version: APP_VERSION });
      if (url.pathname === "/api/pair") {
        if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
        if (!originOk(req)) return sendJson(res, 403, { error: "Origin not allowed" });
        let body: { code?: unknown; deviceName?: unknown } = {};
        try {
          body = JSON.parse(await readBody(req)) as typeof body;
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON" });
        }
        const out = d.pairing.exchange(body.code, body.deviceName);
        if (!out.ok) return sendJson(res, out.status, { error: out.error });
        d.log?.(`paired new device ${out.deviceId}`);
        return sendJson(res, 200, { deviceId: out.deviceId, deviceToken: out.deviceToken });
      }
      const audio = /^\/api\/answers\/([\w-]{1,100})\/audio$/.exec(url.pathname);
      if (audio) {
        if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "GET only" });
        const id = audio[1]!;
        if (!verifyAudioSignature(d.signingSecret, id, url.searchParams.get("exp"), url.searchParams.get("sig"))) return sendJson(res, 403, { error: "Link expired" });
        if (!d.answers.hasAudio(id)) return sendJson(res, 404, { error: "No audio" });
        return serveFile(req, res, d.answers.audioPath(id), "private, max-age=600");
      }
      if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
      return serveStatic(req, res, url.pathname);
    } catch (err) {
      d.log?.(`http error: ${(err as Error).message}`);
      if (!res.headersSent) sendJson(res, 500, { error: "Server error" });
      else res.end();
    }
  });

  function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "GET only" });
    const root = d.staticDir;
    if (!root || !existsSync(join(root, "index.html"))) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      return void res.end("Phone app not built. Run: npm run build");
    }
    const rel = normalize(decodeURIComponent(pathname)).replace(/^([\\/])+/, "");
    let file = resolve(root, rel);
    if (!file.startsWith(resolve(root) + sep) && file !== resolve(root)) return sendJson(res, 403, { error: "Forbidden" });
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html"); // SPA fallback (/pair etc.)
    const isHtml = file.endsWith(".html");
    if (isHtml) {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' wss: ws:; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
    }
    serveFile(req, res, file, isHtml || file.endsWith(".webmanifest") ? "no-store" : "public, max-age=31536000, immutable");
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || !originOk(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws));
  });

  function onSocket(ws: WebSocket): void {
    let client: PhoneClient | null = null;
    let remove: (() => void) | null = null;
    const authTimer = setTimeout(() => ws.close(4401, "auth timeout"), AUTH_TIMEOUT_MS);
    let alive = true;
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      // A revoked phone loses its open connection too, not only future ones.
      if (client && !d.pairing.has(client.deviceId)) return ws.close(4401, "revoked");
      alive = false;
      ws.ping();
    }, 30_000);
    ws.on("pong", () => (alive = true));
    const send = (m: CompanionMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    };
    ws.on("message", (data, isBinary) => {
      const msg = isBinary ? null : parsePhoneMessage(data.toString());
      if (!client) {
        // The very first message must be a valid auth message.
        clearTimeout(authTimer);
        const device = msg?.type === "auth" ? d.pairing.verify(msg.deviceToken) : null;
        if (!device) return ws.close(4401, "unauthorized");
        client = { deviceId: device.id, send };
        remove = d.hub.addClient(client);
        send({ type: "auth.ok", deviceId: device.id, appName: APP_NAME, version: APP_VERSION, host: hostname().slice(0, 100) });
        void d.hub.welcome(client);
        return;
      }
      if (!d.pairing.has(client.deviceId)) return ws.close(4401, "revoked");
      if (!msg) return send({ type: "toast", level: "warn", message: "Ignored an invalid message." });
      void d.hub.handle(client, msg);
    });
    ws.on("close", () => {
      clearTimeout(authTimer);
      clearInterval(ping);
      remove?.();
    });
  }

  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    // Loopback only. Tailscale Serve proxies the public HTTPS URL to this port.
    server.listen(port, LOOPBACK_HOST, () => {
      actualPort = (server.address() as AddressInfo).port;
      resolveStart({
        server,
        port: actualPort,
        close: () =>
          new Promise<void>((r) => {
            for (const c of wss.clients) c.terminate();
            wss.close();
            server.close(() => r());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
