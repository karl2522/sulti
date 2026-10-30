import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AnswerStore } from "./answers.js";
import { AppServerConnection, CodexBridge } from "./appserver.js";
import type { Config } from "./config.js";
import { Hub } from "./hub.js";
import { copyToPcClipboard } from "./listen/clipboard.js";
import { startControlServer } from "./listen/control-server.js";
import { renderWav } from "./listen/tts.js";
import { Pairing } from "./pairing.js";
import { startPhoneServer, type RunningServer } from "./server.js";
import { SessionRegistry, loadSessions } from "./sessions.js";
import { ThreadStore, loadSecrets } from "./store.js";

export interface CompanionHandle {
  config: Config;
  hub: Hub;
  pairing: Pairing;
  answers: AnswerStore;
  conn: AppServerConnection;
  phone: RunningServer;
  control: RunningServer;
  publicUrl(): string;
  newPairing(): { code: string; url: string };
  stop(): Promise<void>;
}

export interface CompanionOverrides {
  renderAudio?: (speechText: string, outFile: string) => Promise<void>;
  copyToPc?: (text: string) => Promise<void>;
  backoff?: number[];
  log?: (msg: string) => void;
}

const here = dirname(fileURLToPath(import.meta.url));
export function phoneDistDir(): string | null {
  for (const p of [resolve(here, "../../phone/dist"), resolve(here, "../../../apps/phone/dist")]) if (existsSync(p)) return p;
  return null;
}

export async function startCompanion(config: Config, o: CompanionOverrides = {}): Promise<CompanionHandle> {
  const log = o.log ?? (() => {});
  const secrets = loadSecrets(config.dataDir);
  const registry = new SessionRegistry(loadSessions(config.dataDir), join(config.dataDir, "unlisted.json"));
  const threads = new ThreadStore(config.dataDir);
  const answers = new AnswerStore(config.dataDir);
  const pairing = new Pairing(config.dataDir);
  const conn = new AppServerConnection({
    mode: config.mode,
    command: config.appServerCommand,
    sharedUrl: config.sharedUrl,
    sharedTokenFile: config.sharedTokenFile,
    log,
    ...(o.backoff ? { backoff: o.backoff } : {}),
  });
  const hub = new Hub({
    registry,
    answers,
    threads,
    signingSecret: secrets.signingSecret,
    renderAudio: o.renderAudio ?? ((text, out) => renderWav(text, out, config.tts)),
    copyToPc: o.copyToPc ?? copyToPcClipboard,
    log,
  });
  hub.bridge = new CodexBridge(conn, threads, hub.bridgeEvents(), log);
  conn.onUp(() => void hub.bridge.resumeKnown(registry.list()));

  const phone = await startPhoneServer(
    { hub, pairing, answers, signingSecret: secrets.signingSecret, publicUrl: () => config.publicUrl, dev: config.dev, staticDir: phoneDistDir(), log },
    config.port,
  );
  const publicUrl = () => config.publicUrl ?? `http://127.0.0.1:${phone.port}`;
  const newPairing = () => {
    const code = pairing.createCode();
    return { code, url: `${publicUrl()}/pair#code=${code}` };
  };
  const control = await startControlServer({ hookSecret: secrets.hookSecret, onStop: (s) => hub.onHookAnswer(s), newPairing, log }, config.hookPort);
  void conn.start();

  return {
    config,
    hub,
    pairing,
    answers,
    conn,
    phone,
    control,
    publicUrl,
    newPairing,
    async stop() {
      conn.stop();
      await Promise.all([phone.close(), control.close()]);
    },
  };
}
