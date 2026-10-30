#!/usr/bin/env node
// Mock "codex app-server": JSON-RPC as JSONL over stdio, zero Codex usage.
// Replays fixtures from test/fixtures/app-server/ for each turn.
//
//   node test/mock-app-server/server.mjs [--scenario normal] [--log file]
//        [--crash-after-turns N] [--seed '<json threads>'] [--delay ms]
//
// Per-turn scenario: a "skill" input item selects "skill"; text containing
// "[scenario:NAME]" selects NAME; otherwise --scenario (default "normal").
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "app-server");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const defaultScenario = opt("scenario", "normal");
const logFile = opt("log", null);
const crashAfter = Number(opt("crash-after-turns", "0"));
const delay = Number(opt("delay", "2"));

const SKILLS = ["execute-plans", "systematic-debugging", "writing-tests"].map((name) => ({
  name,
  description: `Fictional test skill ${name}`,
  path: `/mock/skills/${name}/SKILL.md`,
  scope: "user",
  enabled: true,
  pluginId: null,
}));

let initialized = false;
let seq = 0;
let turnsCompleted = 0;
const threads = new Map();
const turns = new Map(); // turnId -> { threadId, interrupted, onInterrupt }
const pendingServerRequests = new Map(); // id -> resolve
for (const t of JSON.parse(opt("seed", "[]"))) threads.set(t.id, makeThread(t));

function makeThread(p) {
  const now = 1790000000 + seq;
  return { id: p.id, cwd: p.cwd, preview: p.preview ?? "", name: p.name ?? null, createdAt: now, updatedAt: now, goal: null, ephemeral: !!p.ephemeral };
}
function threadView(t) {
  return {
    id: t.id, sessionId: t.id, forkedFromId: null, parentThreadId: null, preview: t.preview, ephemeral: t.ephemeral,
    section: null, sectionEnteredAt: null, projectId: null, historyMode: "paginated", modelProvider: "mock", model: "mock-model",
    reasoningEffort: null, createdAt: t.createdAt, updatedAt: t.updatedAt, recencyAt: t.updatedAt, status: { type: "idle" },
    path: null, cwd: t.cwd, cliVersion: "0.0.0-mock", originator: "sulti", source: "vscode", threadSource: null,
    agentNickname: null, agentRole: null, gitInfo: null, name: t.name, turns: [],
  };
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function log(entry) {
  if (logFile) appendFileSync(logFile, JSON.stringify(entry) + "\n");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fill(value, vars) {
  return JSON.parse(JSON.stringify(value).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? JSON.stringify(String(vars[k])).slice(1, -1) : m)));
}
function loadScenario(name) {
  return readFileSync(join(FIXTURES, `${name}.jsonl`), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

async function runTurn(thread, turnId, scenario, vars) {
  const state = turns.get(turnId);
  const steps = [...loadScenario(scenario)];
  while (steps.length) {
    const step = steps.shift();
    if (state.interrupted && !("$waitForInterrupt" in step)) {
      // Interrupt arrived outside a wait point: finish as interrupted.
      send({ method: "turn/completed", params: { threadId: thread.id, turn: { id: turnId, items: [], status: "interrupted", error: null } } });
      break;
    }
    if (step.$waitForInterrupt) {
      if (!state.interrupted) await new Promise((r) => (state.onInterrupt = r));
      continue;
    }
    if (step.$request) {
      const id = `srv-${++seq}`;
      vars.requestId = id;
      const answer = new Promise((r) => pendingServerRequests.set(id, r));
      send({ id, method: step.$request.method, params: fill(step.$request.params, vars) });
      const result = await answer;
      vars.decision = typeof result?.decision === "string" ? result.decision : "decline";
      continue;
    }
    if (step.$ifDecision) {
      steps.unshift(...(step.$ifDecision.includes(vars.decision) ? step.then : step.else));
      continue;
    }
    await sleep(delay);
    send(fill(step, vars));
  }
  thread.updatedAt += 1;
  turns.delete(turnId);
  turnsCompleted++;
  if (crashAfter && turnsCompleted >= crashAfter) {
    await sleep(20);
    process.exit(1);
  }
}

function scenarioFor(input) {
  if (input.some((i) => i.type === "skill")) return "skill";
  const text = input.filter((i) => i.type === "text").map((i) => i.text).join(" ");
  return /\[scenario:([\w-]+)\]/.exec(text)?.[1] ?? defaultScenario;
}

const FORBIDDEN = (m) => m === "thread/shellCommand" || m.startsWith("command/exec") || m.startsWith("process/");

async function handleRequest(id, method, params = {}) {
  log({ method, params });
  const ok = (result) => send({ id, result });
  const fail = (code, message) => send({ id, error: { code, message } });
  if (FORBIDDEN(method)) return fail(-32600, "FORBIDDEN method reached the mock: " + method);
  if (method === "initialize") {
    if (initialized) return fail(-32600, "Already initialized");
    initialized = true;
    return ok({ userAgent: "mock/0.0.0", codexHome: "<mock>", platformFamily: "windows", platformOs: "windows" });
  }
  if (!initialized) return fail(-32002, "Not initialized");
  switch (method) {
    case "thread/start": {
      const t = makeThread({ id: `thread-${++seq}`, cwd: params.cwd ?? "/mock/cwd", ephemeral: params.ephemeral });
      t.sandbox = params.sandbox ?? null;
      t.approvalPolicy = params.approvalPolicy ?? null;
      threads.set(t.id, t);
      ok({ thread: threadView(t), model: "mock-model", modelProvider: "mock", serviceTier: null, disabledPluginIds: [], cwd: t.cwd, instructionSources: [], approvalPolicy: t.approvalPolicy ?? "on-request", approvalsReviewer: "user", sandbox: { type: "readOnly" }, reasoningEffort: null });
      return send({ method: "thread/started", params: { thread: threadView(t) } });
    }
    case "thread/resume": {
      const t = threads.get(params.threadId);
      if (!t) return fail(-32600, `no rollout found for thread id ${params.threadId}`);
      // Stands in for a thread another Codex process has open.
      if (t.preview.includes("[locked]")) return fail(-32600, `thread ${t.id} already has an active writer`);
      return ok({ thread: threadView(t), model: "mock-model", modelProvider: "mock", serviceTier: null, disabledPluginIds: [], cwd: t.cwd, instructionSources: [], approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "readOnly" }, reasoningEffort: null, collaborationMode: null, turnsBackwardsCursor: null, itemsBackwardsCursor: null });
    }
    case "thread/fork": {
      const src = threads.get(params.threadId);
      if (!src) return fail(-32600, `no rollout found for thread id ${params.threadId}`);
      const t = makeThread({ id: `thread-${++seq}`, cwd: params.cwd ?? src.cwd, ephemeral: params.ephemeral });
      t.preview = src.preview.replace("[locked]", "").trim();
      threads.set(t.id, t);
      return ok({ thread: threadView(t), model: "mock-model", modelProvider: "mock", serviceTier: null, disabledPluginIds: [], cwd: t.cwd, instructionSources: [], approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "readOnly" }, reasoningEffort: null });
    }
    case "thread/list": {
      const cwds = params.cwd == null ? null : [].concat(params.cwd);
      const data = [...threads.values()].filter((t) => !t.ephemeral && (!cwds || cwds.includes(t.cwd))).sort((a, b) => b.updatedAt - a.updatedAt).map(threadView);
      return ok({ data, nextCursor: null, backwardsCursor: null });
    }
    case "thread/read": {
      const t = threads.get(params.threadId);
      return t ? ok({ thread: threadView(t) }) : fail(-32600, "thread not found");
    }
    case "turn/start": {
      const t = threads.get(params.threadId);
      if (!t) return fail(-32600, "thread not found");
      const turnId = `turn-${++seq}`;
      const input = params.input ?? [];
      const text = input.filter((i) => i.type === "text").map((i) => i.text).join(" ");
      const skill = input.find((i) => i.type === "skill");
      if (!t.preview) t.preview = text.slice(0, 80);
      turns.set(turnId, { threadId: t.id, interrupted: false, onInterrupt: null });
      ok({ turn: { id: turnId, rootTurnId: turnId, items: [], itemsView: "notLoaded", status: "inProgress", error: null, startedAt: null, completedAt: null, durationMs: null } });
      const vars = { threadId: t.id, turnId, prompt: text, cwd: t.cwd, skillName: skill?.name ?? "", skillPath: skill?.path ?? "", requestId: "", decision: "" };
      void runTurn(t, turnId, scenarioFor(input), vars);
      return;
    }
    case "turn/interrupt": {
      const st = turns.get(params.turnId);
      if (!st || st.threadId !== params.threadId) return fail(-32600, "no active turn to interrupt");
      st.interrupted = true;
      st.onInterrupt?.();
      return ok({});
    }
    case "skills/list": {
      const cwds = params.cwds?.length ? params.cwds : ["/mock/cwd"];
      return ok({ data: cwds.map((cwd) => ({ cwd, skills: SKILLS, errors: [] })) });
    }
    case "thread/goal/set": {
      const t = threads.get(params.threadId);
      if (!t) return fail(-32600, "thread not found");
      if (t.ephemeral) return fail(-32600, `ephemeral thread does not support goals: ${t.id}`);
      if (params.objective != null) {
        const o = String(params.objective).trim();
        if (!o || o.length > 4000) return fail(-32602, "goal objective must be non-empty and at most 4000 characters");
        t.goal = { threadId: t.id, objective: o, status: params.status ?? "active", tokenBudget: params.tokenBudget ?? null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1790000000, updatedAt: 1790000000 };
      } else {
        if (!t.goal) return fail(-32600, "no goal to update");
        if (params.status) t.goal.status = params.status;
        t.goal.updatedAt += 1;
      }
      ok({ goal: t.goal });
      return send({ method: "thread/goal/updated", params: { threadId: t.id, turnId: null, goal: t.goal } });
    }
    case "thread/goal/get": {
      const t = threads.get(params.threadId);
      return t ? ok({ goal: t.goal }) : fail(-32600, "thread not found");
    }
    case "thread/goal/clear": {
      const t = threads.get(params.threadId);
      if (!t) return fail(-32600, "thread not found");
      const cleared = !!t.goal;
      t.goal = null;
      ok({ cleared });
      return send({ method: "thread/goal/cleared", params: { threadId: t.id } });
    }
    case "model/list":
      return ok({ data: [{ id: "mock-model", model: "mock-model", displayName: "Mock", isDefault: true }], nextCursor: null });
    case "windowsSandbox/readiness":
      return ok({ status: "ready" });
    default:
      return fail(-32601, `method not found: ${method}`);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.method && msg.id !== undefined) void handleRequest(msg.id, msg.method, msg.params);
    else if (msg.method) log({ notification: msg.method });
    else if (msg.id !== undefined && pendingServerRequests.has(msg.id)) {
      log({ response: msg.id, result: msg.result });
      pendingServerRequests.get(msg.id)(msg.result);
      pendingServerRequests.delete(msg.id);
    }
  }
});
process.stdin.on("end", () => process.exit(0));
