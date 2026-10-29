/**
 * T5: can two clients share one Codex thread through a shared app-server?
 *
 *   node tools/shared-session/two-clients.ts [--turns 0|1|3] [--port 4511] [--url ws://127.0.0.1:4500 --token-file <path>]
 *
 * Without --url it starts its own server (temp token file, loopback, temp cwd)
 * and stops it afterwards. Needs `npm run build` first (uses the built protocol
 * client and the companion's codex resolver).
 *
 * --turns 3 (the full plan): A starts a persisted thread and runs a turn, B
 * resumes it, A runs a second turn that B must observe, then B runs a turn
 * that A must observe.
 * --turns 1 (default, for a tight live-turn budget): A starts the thread and
 * its only turn; B resumes the thread while that turn is running and must
 * receive the rest of it live (agentMessage item/completed + turn/completed).
 * Resuming before the first turn fails ("no rollout found"), which --turns 0
 * shows for free.
 * --turns 0: plumbing only (server, auth, start, resume attempt), no model turn.
 *
 * Free check in both modes: a client without the token is refused. Only
 * methods on the protocol client's allowlist are used. Evidence (ids
 * shortened) goes to test/live-output/shared-session.json, which is gitignored.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerClient, connectWebSocket } from "@sulti/protocol";

type SpawnModule = typeof import("../../apps/companion/src/spawn.js");

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../test/live-output");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const turns = Number(arg("turns") ?? "1");
if (turns !== 0 && turns !== 1 && turns !== 3) throw new Error("--turns must be 0, 1 or 3");
const short = (id: unknown) => (typeof id === "string" ? id.slice(0, 8) + "…" : String(id));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Seen {
  method: string;
  threadId?: string;
  turnId?: string;
  itemType?: string;
}

function summarize(method: string, params: unknown): Seen {
  const p = (params ?? {}) as Record<string, unknown>;
  const turn = p.turn as Record<string, unknown> | undefined;
  const item = p.item as Record<string, unknown> | undefined;
  return {
    method,
    threadId: typeof p.threadId === "string" ? p.threadId : undefined,
    turnId: typeof p.turnId === "string" ? p.turnId : typeof turn?.id === "string" ? turn.id : undefined,
    itemType: typeof item?.type === "string" ? item.type : undefined,
  };
}

class Lab {
  readonly seen: Seen[] = [];
  private waiters: { test: (s: Seen) => boolean; done: () => void }[] = [];
  readonly name: string;
  readonly client: AppServerClient;
  // Plain fields (no parameter properties) so Node can run this file by stripping types.
  constructor(name: string, client: AppServerClient) {
    this.name = name;
    this.client = client;
    client.onAny((method, params) => {
      const s = summarize(method, params);
      this.seen.push(s);
      this.waiters = this.waiters.filter((w) => {
        if (!w.test(s)) return true;
        w.done();
        return false;
      });
    });
    // Never approve anything in an experiment.
    client.onServerRequest(() => ({ decision: "decline" }));
  }
  waitFor(test: (s: Seen) => boolean, ms: number, what: string): Promise<void> {
    if (this.seen.some(test)) return Promise.resolve();
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`${this.name} never saw ${what}`)), ms);
      this.waiters.push({ test, done: () => (clearTimeout(timer), res()) });
    });
  }
  sawTurn(turnId: string): { itemCompleted: boolean; turnCompleted: boolean } {
    return {
      itemCompleted: this.seen.some((s) => s.method === "item/completed" && s.turnId === turnId && s.itemType === "agentMessage"),
      turnCompleted: this.seen.some((s) => s.method === "turn/completed" && s.turnId === turnId),
    };
  }
}

async function connect(name: string, url: string, token: string | undefined, deadline = Date.now() + 30_000): Promise<Lab> {
  for (;;) {
    try {
      const transport = await connectWebSocket(url, token ? { bearerToken: token } : {});
      const client = new AppServerClient(transport, { timeoutMs: 60_000 });
      await client.initialize({ name: `sulti-lab-${name.toLowerCase()}`, title: `Sulti lab ${name}`, version: "0.1.0" });
      return new Lab(name, client);
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await sleep(500);
    }
  }
}

async function main(): Promise<void> {
  const results: { step: string; pass: boolean; detail: string }[] = [];
  const record = (step: string, pass: boolean, detail: string) => {
    results.push({ step, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${step}  (${detail})`);
  };
  const cwd = mkdtempSync(join(tmpdir(), "sulti-t5-"));
  let url = arg("url");
  let token: string | undefined;
  let stopServer = () => {};
  let turnsUsed = 0;

  if (url) {
    const tokenFile = arg("token-file");
    token = tokenFile ? readFileSync(tokenFile, "utf8").trim() : undefined;
  } else {
    const port = Number(arg("port") ?? "4511");
    url = `ws://127.0.0.1:${port}`;
    token = randomBytes(32).toString("hex");
    const tokenDir = mkdtempSync(join(tmpdir(), "sulti-t5-token-"));
    const tokenFile = join(tokenDir, "token");
    writeFileSync(tokenFile, token);
    const spawnMod = (await import(new URL("../../apps/companion/dist/spawn.js", import.meta.url).href)) as SpawnModule;
    const child = spawnMod.spawnResolved(spawnMod.resolveCodex(), ["app-server", "--listen", url, "--ws-auth", "capability-token", "--ws-token-file", tokenFile], { cwd });
    child.stdout.resume();
    child.stderr.resume();
    stopServer = () => {
      // The resolved command may be node + codex.js with codex.exe underneath;
      // kill the whole tree so the listener doesn't outlive the test.
      if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else child.kill();
      rmSync(tokenDir, { recursive: true, force: true });
    };
  }
  if (!new URL(url).hostname.match(/^(127\.0\.0\.1|localhost|\[::1\])$/)) throw new Error("Loopback only.");

  const turn = async (lab: Lab, threadId: string, text: string) => {
    turnsUsed += 1;
    const res = await lab.client.request("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }] });
    return res.turn.id;
  };

  let a: Lab | null = null;
  let b: Lab | null = null;
  try {
    a = await connect("A", url, token);
    record("A connects with the capability token", true, "initialize ok");

    const anon = await connect("anon", url, undefined, Date.now() + 2000).then(
      (l) => (l.client.close(), "accepted"),
      (e: Error) => `refused: ${e.message.slice(0, 60)}`,
    );
    record("a client without the token is refused", anon !== "accepted", anon);

    const { thread } = await a.client.request("thread/start", { cwd, sandbox: "read-only", approvalPolicy: "on-request", ephemeral: false });
    record("A starts a persisted thread", true, `thread ${short(thread.id)}`);

    if (turns === 1) {
      const t = await turn(a, thread.id, "Write the numbers one to forty in words, one per line. Do not use any tools.");
      b = await connect("B", url, token);
      let resumed = "not tried";
      for (let i = 0; i < 40; i++) {
        resumed = await b.client.request("thread/resume", { threadId: thread.id }).then(
          () => "ok",
          (e: Error) => `error: ${e.message.slice(0, 120)}`,
        );
        if (resumed === "ok" || a.sawTurn(t).turnCompleted) break;
        await sleep(250);
      }
      const midTurn = !a.sawTurn(t).turnCompleted;
      record("B resumes the thread while A's turn runs", resumed === "ok" && midTurn, `${resumed}, turn still running: ${midTurn}`);
      await a.waitFor((s) => s.method === "turn/completed" && s.turnId === t, 180_000, "its turn complete");
      await b.waitFor((s) => s.method === "turn/completed" && s.turnId === t, 5000, "A's turn complete").catch(() => undefined);
      const seen = b.sawTurn(t);
      record("B observes the rest of A's turn live", seen.itemCompleted && seen.turnCompleted, JSON.stringify(seen));
      return;
    }

    const t1 = turns === 3 ? await turn(a, thread.id, "Reply with only the word ONE.") : null;
    if (t1) {
      await a.waitFor((s) => s.method === "turn/completed" && s.turnId === t1, 180_000, "its first turn complete");
      record("A runs a first turn", true, `turn ${short(t1)}`);
    }

    b = await connect("B", url, token);
    const resumed = await b.client.request("thread/resume", { threadId: thread.id }).then(
      () => "ok",
      (e: Error) => `error: ${e.message.slice(0, 120)}`,
    );
    record(`B resumes the thread${t1 ? "" : " before any turn"}`, resumed === "ok", resumed);
    if (resumed !== "ok") return;

    if (turns === 3) {
      const t2 = await turn(a, thread.id, "Reply with only the word TWO.");
      await a.waitFor((s) => s.method === "turn/completed" && s.turnId === t2, 180_000, "turn 2 complete");
      await b.waitFor((s) => s.method === "turn/completed" && s.turnId === t2, 5000, "turn 2 complete").catch(() => undefined);
      const seen = b.sawTurn(t2);
      record("B observes A's turn live", seen.itemCompleted && seen.turnCompleted, JSON.stringify(seen));
    }

    if (turns === 0) return;
    const tb = await turn(b, thread.id, turns === 3 ? "Reply with only the word THREE." : "Reply with only the word PING.");
    await b.waitFor((s) => s.method === "turn/completed" && s.turnId === tb, 180_000, "its own turn complete");
    await a.waitFor((s) => s.method === "turn/completed" && s.turnId === tb, 5000, "B's turn complete").catch(() => undefined);
    const seenByA = a.sawTurn(tb);
    record("A observes B's turn live", seenByA.itemCompleted && seenByA.turnCompleted, JSON.stringify(seenByA));
  } catch (err) {
    record("run", false, (err as Error).message);
  } finally {
    a?.client.close();
    b?.client.close();
    stopServer();
    mkdirSync(outDir, { recursive: true });
    const methods = (l: Lab | null) => [...new Set(l?.seen.map((s) => s.method) ?? [])].sort();
    const evidence = { at: new Date().toISOString(), mode: `${turns}-turn`, turnsUsed, results, methodsSeenByA: methods(a), methodsSeenByB: methods(b) };
    writeFileSync(join(outDir, "shared-session.json"), JSON.stringify(evidence, null, 2));
    const ok = results.length > 0 && results.every((r) => r.pass);
    console.log(ok ? "T5 PASSED" : "T5 FAILED", `(${turnsUsed} live turn${turnsUsed === 1 ? "" : "s"})`);
    setTimeout(() => process.exit(ok ? 0 : 1), 300);
  }
}

void main();
