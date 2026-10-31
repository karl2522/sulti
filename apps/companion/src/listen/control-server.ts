import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { LOOPBACK_HOST } from "@sulti/core";
import { PAIR_CODE_TTL_MS } from "../pairing.js";
import { qrSvg } from "../qr.js";
import type { RunningServer } from "../server.js";
import { parseStopHookBody } from "./hook.js";

export const HOOK_SECRET_HEADER = "x-sulti-hook-secret";
const MAX_HOOK_BODY = 2 * 1024 * 1024;

export interface ControlServerDeps {
  hookSecret: string;
  onStop: (stop: { cwd: string; sessionId: string | null; turnId: string | null; message: string }) => void;
  /** Creates a new pairing code; returns the pairing URL. */
  newPairing: () => { code: string; url: string };
  /** True while a pairing code is unused and unexpired. */
  pairingPending: (code: string) => boolean;
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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page behind the "Sulti pairing" desktop shortcut: a QR code the iPhone camera can scan. */
function pairPage(code: string, url: string): string {
  const pretty = code.slice(0, 5) + "-" + code.slice(5);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pair a phone with Sulti</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1012;color:#f2f2f2;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(420px,90vw);text-align:center}h1{font-size:26px;margin:0 0 6px}p{color:#a9abb0;margin:0 0 20px}
.qr{background:#fff;border-radius:20px;padding:14px;width:min(300px,70vw);margin:0 auto 20px}.qr svg{display:block;width:100%;height:auto}
.code{font:600 22px/1 ui-monospace,Consolas,monospace;letter-spacing:.08em;color:#f2f2f2;white-space:nowrap}.small{font-size:14px}
.done{font-size:64px;line-height:1;margin:30px 0 12px;color:#4ade80}a.btn{display:inline-block;background:#f2f2f2;color:#0f1012;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:600}
</style></head><body><main id="m">
<h1>Pair your iPhone</h1><p>Open the Camera on your iPhone and point it at this code, then tap the link that appears.</p>
<div class="qr">${qrSvg(url)}</div>
<p class="small">Or open <b>${esc(new URL(url).host)}</b> and type <span class="code">${pretty}</span></p>
<p class="small" id="left"></p></main>
<script>
const end=Date.now()+${PAIR_CODE_TTL_MS},m=document.getElementById("m"),left=document.getElementById("left");
let t;
const show=(html)=>{m.innerHTML=html;clearInterval(t)};
const tick=async()=>{
  const s=Math.max(0,Math.round((end-Date.now())/1000));
  left.textContent="Works once. Expires in "+Math.floor(s/60)+":"+String(s%60).padStart(2,"0")+".";
  const r=await fetch("/pair/status?code=${code}").then((x)=>x.json()).catch(()=>null);
  if(r&&!r.pending)show(s>0?'<div class="done">&#10003;</div><h1>Phone connected</h1><p>You can close this page.</p><a class="btn" href="/pair">Pair another</a>'
    :'<h1>This code expired</h1><p>Codes work for 10 minutes.</p><a class="btn" href="/pair">New code</a>');
};
t=setInterval(tick,2000);tick();
</script></body></html>`;
}

/**
 * Local control server (127.0.0.1:7418). Never proxied. Accepts Stop-hook
 * posts and pairing-code requests from the local CLI, both with the hook secret,
 * and serves the pairing QR page to a browser on this PC.
 */
export function startControlServer(d: ControlServerDeps, port: number): Promise<RunningServer> {
  let actualPort = port;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && (url.pathname === "/pair" || url.pathname === "/pair/status")) {
      // Only a browser on this PC: the Host check stops DNS rebinding, and Sec-Fetch-Site
      // stops other websites from making the browser create codes.
      const host = req.headers.host;
      const site = req.headers["sec-fetch-site"];
      if ((host !== `127.0.0.1:${actualPort}` && host !== `localhost:${actualPort}`) || (site && site !== "none" && site !== "same-origin")) return reply(res, 403, { error: "forbidden" });
      if (url.pathname === "/pair/status") return reply(res, 200, { pending: d.pairingPending(url.searchParams.get("code") ?? "") });
      const { code, url: link } = d.newPairing();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
      return void res.end(pairPage(code, link));
    }
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
          d.onStop({ cwd: parsed.cwd, sessionId: parsed.sessionId, turnId: parsed.turnId, message: parsed.message });
        } catch (err) {
          d.log?.(`hook handling failed: ${(err as Error).message}`);
        }
      }
    });
  });
  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK_HOST, () => {
      actualPort = (server.address() as AddressInfo).port;
      resolveStart({
        server,
        port: actualPort,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
