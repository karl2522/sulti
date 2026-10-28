#!/usr/bin/env node
// Live capture of one tiny app-server turn, used to build test fixtures.
// Costs ONE Codex turn. Runs in a fresh temp dir with a read-only sandbox and
// an ephemeral thread. Raw output goes to test/live-output/ (gitignored); the
// committed fixtures under test/fixtures/app-server/ are redacted by hand.
//   npm run build -w @sulti/protocol && node packages/protocol/scripts/capture.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerClient, stdioTransport } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = join(root, "test", "live-output");
mkdirSync(outDir, { recursive: true });
const cwd = mkdtempSync(join(tmpdir(), "sulti-capture-"));

const child = spawn("codex app-server", { shell: true, stdio: ["pipe", "pipe", "pipe"], cwd });
child.stderr.resume();
const transport = stdioTransport(child);
const lines = [];
transport.onLine((l) => lines.push(l));
const client = new AppServerClient(transport, { timeoutMs: 60_000 });
client.onServerRequest((method) => {
  // Never approve anything during capture.
  if (method.endsWith("requestApproval")) return { decision: "decline" };
  throw new Error("unsupported in capture");
});

const summary = {};
try {
  summary.initialize = await client.initialize({ name: "sulti", title: "Sulti", version: "0.1.0" });
  summary.windowsSandbox = await client.request("windowsSandbox/readiness", undefined).catch((e) => ({ error: e.message }));
  const skills = await client.request("skills/list", { cwds: [cwd] }).catch((e) => ({ error: e.message }));
  summary.skillsCount = skills.data?.[0]?.skills?.length ?? skills;
  summary.skillsSampleKeys = skills.data?.[0]?.skills?.[0] ? Object.keys(skills.data[0].skills[0]) : [];
  const started = await client.request("thread/start", { cwd, sandbox: "read-only", approvalPolicy: "on-request", ephemeral: true });
  summary.threadStartKeys = Object.keys(started);
  const threadId = started.thread.id;
  const done = new Promise((res) => client.on("turn/completed", (p) => p.threadId === threadId && res(p)));
  await client.request("turn/start", {
    threadId,
    input: [{ type: "text", text: "Reply with only the word PONG.", text_elements: [] }],
  });
  const completed = await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error("turn timeout")), 120_000))]);
  summary.turnStatus = completed.turn.status;
  summary.goalGet = await client.request("thread/goal/get", { threadId }).catch((e) => ({ error: e.message }));
} catch (err) {
  summary.error = String(err?.message ?? err);
} finally {
  const methods = {};
  for (const l of lines) {
    const m = JSON.parse(l);
    const key = m.method ?? (m.error ? "<error>" : "<result>");
    methods[key] = (methods[key] ?? 0) + 1;
  }
  summary.methods = methods;
  writeFileSync(join(outDir, "capture-normal.jsonl"), lines.join("\n") + "\n");
  writeFileSync(join(outDir, "capture-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ turnStatus: summary.turnStatus, error: summary.error, windowsSandbox: summary.windowsSandbox, methods }, null, 2));
  client.close();
  setTimeout(() => process.exit(0), 500);
}
