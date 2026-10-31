#!/usr/bin/env node
import qrcode from "qrcode-terminal";
import { APP_NAME, APP_VERSION } from "@sulti/core";
import { startCompanion } from "./companion.js";
import { loadConfig } from "./config.js";
import { HOOK_SECRET_HEADER } from "./listen/control-server.js";
import { listVoices } from "./listen/tts.js";
import { Pairing } from "./pairing.js";
import { loadSessions } from "./sessions.js";
import { loadSecrets } from "./store.js";
import { detectTailscaleUrl } from "./tailscale.js";

const HELP = `${APP_NAME} companion ${APP_VERSION}

Usage:
  sulti start                 Start the companion (default)
  sulti pair                  Print a new pairing code from the running companion
  sulti devices list          List paired devices
  sulti devices revoke <id>   Revoke a paired device
  sulti voices                List installed Windows TTS voices

Data folder: %APPDATA%\\sulti (override with SULTI_DATA_DIR)`;

function printPairing(url: string): void {
  console.log("\nPair your iPhone: open this URL (or scan the QR code). It works once and expires in 10 minutes.\n");
  console.log("  " + url + "\n");
  qrcode.generate(url, { small: true });
}

async function start(): Promise<void> {
  const config = loadConfig();
  if (!config.publicUrl) {
    const ts = await detectTailscaleUrl();
    if (ts) config.publicUrl = ts;
  }
  const sessions = loadSessions(config.dataDir);
  const log = (m: string) => console.log(`[${new Date().toLocaleString()}] ${m}`);
  // One unexpected rejection shouldn't take the phone offline; log it and keep serving.
  process.on("unhandledRejection", (err) => log(`unexpected error: ${err instanceof Error ? err.message : String(err)}`));
  const c = await startCompanion(config, { log });
  console.log(`${APP_NAME} ${APP_VERSION} running.`);
  console.log(`  Phone server:   http://127.0.0.1:${c.phone.port}  (the only port to expose, through Cloudflare Tunnel or Tailscale Serve)`);
  console.log(`  Local control:  http://127.0.0.1:${c.control.port}  (Stop hook only, never expose)`);
  console.log(`  Sessions:       ${sessions.length ? sessions.map((s) => s.name).join(", ") : "none - copy sessions.example.json to the data folder as sessions.json"}`);
  if (!config.publicUrl) console.log("  Public URL:     not set. The iPhone needs HTTPS: set publicUrl in config.json (see docs/DEPLOY.md).");
  else console.log(`  Public URL:     ${config.publicUrl}`);
  if (process.stdout.isTTY) {
    printPairing(c.newPairing().url);
    console.log("Press Enter for a new pairing code. Ctrl+C to quit.");
    process.stdin.on("data", () => printPairing(c.newPairing().url));
  } else {
    // Running in the background with output going to a log: never write pairing codes there.
    console.log("  Pair a phone:   run \"npm run pair\" in the Sulti folder.");
  }
  const shutdown = async () => {
    await c.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

async function pair(): Promise<void> {
  const config = loadConfig();
  const { hookSecret } = loadSecrets(config.dataDir);
  const res = await fetch(`http://127.0.0.1:${config.hookPort}/local/pair-code`, { method: "POST", headers: { [HOOK_SECRET_HEADER]: hookSecret } }).catch(() => null);
  if (!res?.ok) {
    console.error("The companion isn't running. Start it with: npm start");
    process.exit(1);
  }
  printPairing(((await res.json()) as { url: string }).url);
  console.log(`\nA bigger QR code: open http://127.0.0.1:${config.hookPort}/pair on this PC (the "Sulti pairing" desktop shortcut).`);
}

async function main(): Promise<void> {
  const [cmd = "start", sub, arg] = process.argv.slice(2);
  if (cmd === "start") return start();
  if (cmd === "pair") return pair();
  if (cmd === "voices") {
    const voices = await listVoices();
    console.log(voices.length ? voices.join("\n") : "No System.Speech voices found.");
    return;
  }
  if (cmd === "devices") {
    const pairing = new Pairing(loadConfig().dataDir);
    if (sub === "list" || !sub) {
      const list = pairing.list();
      if (!list.length) console.log("No paired devices.");
      for (const d of list) console.log(`${d.id}  ${d.name.padEnd(20)}  paired ${new Date(d.createdAt).toLocaleString()}  last seen ${d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "never"}`);
      return;
    }
    if (sub === "revoke" && arg) {
      console.log(pairing.revoke(arg) ? `Revoked ${arg}. Its open connection closes within 30 seconds.` : `No device ${arg}.`);
      return;
    }
  }
  console.log(HELP);
  if (cmd !== "help" && cmd !== "--help" && cmd !== "-h") process.exitCode = 1;
}

main().catch((err: unknown) => {
  const e = err as NodeJS.ErrnoException;
  console.error(e.code === "EADDRINUSE" ? "Sulti is already running on this PC (its port is in use). Stop the other copy first." : e.message);
  process.exit(1);
});
