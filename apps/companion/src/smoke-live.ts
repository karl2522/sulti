/**
 * npm run smoke:live: two tiny real Codex turns (costs the owner's plan).
 * 1. "Reply with only the word PONG." -> final answer contains PONG.
 * 2. A longer turn, interrupted after the first delta -> status "interrupted".
 * Runs in a fresh temp dir, read-only sandbox, ephemeral thread.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, APP_SLUG, APP_VERSION } from "@sulti/core";
import { AppServerClient, stdioTransport } from "@sulti/protocol";
import { textInput } from "./appserver.js";
import { resolveCodex, spawnResolved } from "./spawn.js";
import { TurnTracker } from "./turns.js";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/live-output");

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), "sulti-smoke-"));
  const child = spawnResolved(resolveCodex(), ["app-server"], { cwd });
  child.stderr.resume();
  const client = new AppServerClient(stdioTransport(child), { timeoutMs: 60_000 });
  const tracker = new TurnTracker();
  const outcomes: Record<string, unknown>[] = [];
  const waiters = new Map<string, (o: Record<string, unknown>) => void>();
  let firstDelta: (() => void) | null = null;
  client.onAny((method, params) => {
    if (method === "item/agentMessage/delta" && firstDelta) {
      firstDelta();
      firstDelta = null;
    }
    const o = tracker.feed(method, params);
    if (o) {
      outcomes.push(o);
      waiters.get(o.turnId)?.(o);
    }
  });
  client.onServerRequest(() => ({ decision: "decline" }));
  const results: { name: string; pass: boolean; detail: string }[] = [];
  const waitTurn = (turnId: string) =>
    new Promise<Record<string, unknown>>((res, rej) => {
      waiters.set(turnId, res);
      setTimeout(() => rej(new Error("turn timeout")), 180_000);
    });
  try {
    await client.initialize({ name: APP_SLUG, title: APP_NAME, version: APP_VERSION });
    const { thread } = await client.request("thread/start", { cwd, sandbox: "read-only", approvalPolicy: "on-request", ephemeral: true });

    const t1 = await client.request("turn/start", { threadId: thread.id, input: [textInput("Reply with only the word PONG.")] });
    const o1 = await waitTurn(t1.turn.id);
    const pong = o1.kind === "answer" && /PONG/.test(String(o1.text));
    results.push({ name: "PONG final answer", pass: pong, detail: `kind=${o1.kind}` });

    const delta = new Promise<void>((r) => (firstDelta = r));
    const t2 = await client.request("turn/start", {
      threadId: thread.id,
      input: [textInput("Write the numbers from 1 to 300 in words, one per line. Do not use any tools.")],
    });
    const done2 = waitTurn(t2.turn.id);
    await Promise.race([delta, done2]);
    await client.request("turn/interrupt", { threadId: thread.id, turnId: t2.turn.id }).catch(() => undefined);
    const o2 = await done2;
    results.push({ name: "interrupt after first delta", pass: o2.kind === "interrupted", detail: `kind=${o2.kind}` });
  } catch (err) {
    results.push({ name: "run", pass: false, detail: (err as Error).message });
  } finally {
    client.close();
  }
  mkdirSync(outDir, { recursive: true });
  const summary = { at: new Date().toISOString(), turnsUsed: 2, results };
  writeFileSync(join(outDir, "smoke-live.json"), JSON.stringify(summary, null, 2));
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}  (${r.detail})`);
  const ok = results.length === 2 && results.every((r) => r.pass);
  console.log(ok ? "smoke:live PASSED" : "smoke:live FAILED");
  setTimeout(() => process.exit(ok ? 0 : 1), 300);
}

void main();
