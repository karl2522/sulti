import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CompanionMessage } from "@sulti/core";
import { HOOK_SECRET_HEADER } from "../../apps/companion/src/listen/control-server.js";
import { REPO_ROOT } from "../mock-app-server/paths.js";
import { Phone, pairDevice, sleep, startTestCompanion, waitClose, type TestCompanion } from "./harness.js";

const running: TestCompanion[] = [];
const phones: Phone[] = [];
afterEach(async () => {
  phones.splice(0).forEach((p) => p.close());
  await Promise.all(running.splice(0).map((t) => t.stop()));
});
async function setup(opts?: Parameters<typeof startTestCompanion>[0]) {
  const t = await startTestCompanion(opts);
  running.push(t);
  const phone = await Phone.connect(t);
  phones.push(phone);
  return { t, phone };
}
type Of<T extends CompanionMessage["type"]> = Extract<CompanionMessage, { type: T }>;
const turnStarts = (t: TestCompanion) => t.mockLog().filter((e) => e.method === "turn/start") as { params: { threadId: string; input: { type: string; text?: string; name?: string; path?: string }[] } }[];

describe("companion against the mock app-server", () => {
  it("binds both listeners to 127.0.0.1", async () => {
    const { t } = await setup();
    expect((t.c.phone.server.address() as { address: string }).address).toBe("127.0.0.1");
    expect((t.c.control.server.address() as { address: string }).address).toBe("127.0.0.1");
  });

  it("prompt -> final answer from the app-server", async () => {
    const { t, phone } = await setup();
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "Run the tests." });
    const a = (await phone.waitFor((m) => m.type === "answer" && m.sessionId === "sole-harbor")) as Of<"answer">;
    expect(a.source).toBe("appServer");
    expect(a.text).toMatch(/^The checkout tests pass\./);
    expect(a.speechText).toContain("Code block, 1 line, skipped.");
    expect(a.speechText).not.toContain("https://");
    // A thread was started with the session's cwd and default policies.
    const start = t.mockLog().find((e) => e.method === "thread/start") as { params: Record<string, unknown> };
    expect(start.params).toMatchObject({ cwd: "D:\\work\\sole-harbor", sandbox: "workspace-write", approvalPolicy: "on-request" });
    expect(turnStarts(t)[0]!.params.input[0]).toEqual({ type: "text", text: "Run the tests.", text_elements: [] });
  });

  it("routes an utterance to the named session and echoes it", async () => {
    const { t, phone } = await setup();
    phone.send({ type: "utterance", text: "in colonel labs run the tests" });
    const r = (await phone.waitFor("route.result")) as Of<"route.result">;
    expect(r.echo).toBe("→ Kernel Labs: Run the tests.");
    expect(r.needsConfirm).toBe(false);
    await phone.waitFor((m) => m.type === "answer" && m.sessionId === "kernel-labs");
    const start = t.mockLog().find((e) => e.method === "thread/start") as { params: Record<string, unknown> };
    expect(start.params).toMatchObject({ cwd: "D:\\work\\kernel-labs", sandbox: "read-only" });
  });

  it("asks before acting on a weak match, and acts after route.confirm", async () => {
    const { phone } = await setup();
    phone.send({ type: "utterance", text: "switch to lead track" });
    const r = (await phone.waitFor("route.result")) as Of<"route.result">;
    if (r.needsConfirm) {
      phone.send({ type: "route.confirm", routeId: r.routeId, accept: true });
    }
    const s = (await phone.waitFor((m) => m.type === "sessions" && m.activeSessionId === "lead-tracker")) as Of<"sessions">;
    expect(s.activeSessionId).toBe("lead-tracker");
  });

  it("approval round trip: request -> tap accept -> answer; voice 'approve' never approves", async () => {
    const { t, phone } = await setup();
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "[scenario:approval] Run the tests." });
    const req = (await phone.waitFor("approval.request")) as Of<"approval.request">;
    expect(req).toMatchObject({ sessionId: "sole-harbor", kind: "command", command: "npm test" });
    expect(req.summary).toContain("Run: npm test");
    expect(req.reason).toBe("Run the test suite outside the sandbox?");
    const st = (await phone.waitFor((m) => m.type === "session.status" && m.status === "waitingApproval")) as Of<"session.status">;
    expect(st.since).toBeGreaterThan(0);
    // The command shows up in the session's "right now" list while it waits.
    await phone.waitFor((m) => m.type === "activity" && m.items.some((i) => i.kind === "command" && i.text === "npm test" && i.status === "running"));

    // Saying "approve" only shows approvals.
    const mark = phone.mark();
    phone.send({ type: "utterance", text: "yes do it" });
    const r = (await phone.waitFor("route.result", 8000, mark)) as Of<"route.result">;
    expect(r.intent).toMatchObject({ kind: "app", action: { type: "showApprovals" } });
    await sleep(100);
    expect(t.mockLog().some((e) => "response" in e)).toBe(false);

    phone.send({ type: "approval.respond", requestId: req.requestId, decision: "accept" });
    await phone.waitFor((m) => m.type === "approval.resolved" && m.requestId === req.requestId);
    const a = (await phone.waitFor("answer")) as Of<"answer">;
    expect(a.text).toBe("I ran the test suite: 12 tests passed.");
    await phone.waitFor((m) => m.type === "activity" && m.items.some((i) => i.text === "npm test" && i.status === "done"));
    expect(t.mockLog().find((e) => "response" in e)).toMatchObject({ result: { decision: "accept" } });
  });

  it("approval decline reaches Codex", async () => {
    const { phone } = await setup();
    phone.send({ type: "prompt.send", sessionId: "lead-tracker", text: "[scenario:approval] Run the tests." });
    const req = (await phone.waitFor("approval.request")) as Of<"approval.request">;
    phone.send({ type: "approval.respond", requestId: req.requestId, decision: "decline" });
    const a = (await phone.waitFor("answer")) as Of<"answer">;
    expect(a.text).toBe("You declined the test run, so I did not run anything.");
  });

  it("/new starts a fresh chat; the next prompt goes to a new thread", async () => {
    const { t, phone } = await setup();
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "Run the tests." });
    await phone.waitFor((m) => m.type === "answer" && m.sessionId === "sole-harbor");
    phone.send({ type: "utterance", text: "/new Check the docs.", sessionId: "sole-harbor" });
    for (let i = 0; i < 100 && turnStarts(t).length < 2; i++) await sleep(30);
    const [first, second] = turnStarts(t);
    expect(second!.params.input[0]).toMatchObject({ type: "text", text: "Check the docs." });
    expect(second!.params.threadId).not.toBe(first!.params.threadId);
    expect(t.mockLog().filter((e) => e.method === "thread/start")).toHaveLength(2);
  });

  it("a chat another Codex window holds is continued as a copy", async () => {
    const { t, phone } = await setup();
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "[locked] Run the tests." });
    await phone.waitFor((m) => m.type === "answer" && m.sessionId === "sole-harbor");
    const locked = turnStarts(t)[0]!.params.threadId;
    phone.send({ type: "thread.new", sessionId: "sole-harbor" });
    phone.send({ type: "thread.attach", sessionId: "sole-harbor", threadId: locked });
    await phone.waitFor((m) => m.type === "toast" && /continues a copy/.test(m.message));
    const current = (m: CompanionMessage) => (m.type === "sessions" ? m.sessions.find((s) => s.id === "sole-harbor")?.threadId : null);
    const copy = current(await phone.waitFor((m) => !!current(m) && current(m) !== locked))!;
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "Keep going." });
    for (let i = 0; i < 100 && turnStarts(t).length < 2; i++) await sleep(30);
    expect(turnStarts(t)[1]!.params.threadId).toBe(copy);
  });

  it("interrupt stops the running turn", async () => {
    const { t, phone } = await setup();
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "[scenario:interrupted] Investigate the auth module." });
    await phone.waitFor((m) => m.type === "session.status" && m.status === "working");
    await sleep(50);
    phone.send({ type: "utterance", text: "stop codex" });
    await phone.waitFor((m) => m.type === "toast" && /stopped/i.test(m.message));
    await phone.waitFor((m) => m.type === "session.status" && m.sessionId === "sole-harbor" && m.status === "idle");
    expect(t.mockLog().some((e) => e.method === "turn/interrupt")).toBe(true);
  });

  it("a prompt sent while Codex works joins the running turn", async () => {
    const { t, phone } = await setup();
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "[scenario:interrupted] Investigate the auth module." });
    await phone.waitFor((m) => m.type === "session.status" && m.status === "working");
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "Also check the logout path." });
    for (let i = 0; i < 100 && !t.mockLog().some((e) => e.method === "turn/steer"); i++) await sleep(30);
    const steer = t.mockLog().find((e) => e.method === "turn/steer") as { params: { expectedTurnId: string; input: { text?: string }[] } };
    expect(steer.params.expectedTurnId).toMatch(/^turn-/);
    expect(steer.params.input[0]!.text).toBe("Also check the logout path.");
    expect(turnStarts(t)).toHaveLength(1);
    phone.send({ type: "turn.interrupt", sessionId: "sole-harbor" });
    await phone.waitFor((m) => m.type === "session.status" && m.status === "idle");
  });

  it("goal set / get / pause / resume / clear", async () => {
    const { t, phone } = await setup();
    phone.send({ type: "utterance", text: "set the goal to finish the authentication migration and make all tests pass" });
    const g1 = (await phone.waitFor((m) => m.type === "goal" && m.goal !== null)) as Of<"goal">;
    expect(g1.goal).toMatchObject({ objective: "Finish the authentication migration and make all tests pass.", status: "active" });
    let mark = phone.mark();
    phone.send({ type: "utterance", text: "pause the goal" });
    expect(((await phone.waitFor((m) => m.type === "goal" && m.goal?.status === "paused", 8000, mark)) as Of<"goal">).goal?.status).toBe("paused");
    mark = phone.mark();
    phone.send({ type: "goal.update", sessionId: "sole-harbor", status: "active" });
    await phone.waitFor((m) => m.type === "goal" && m.goal?.status === "active", 8000, mark);
    mark = phone.mark();
    phone.send({ type: "goal.get", sessionId: "sole-harbor" });
    expect(((await phone.waitFor("goal", 8000, mark)) as Of<"goal">).goal?.objective).toMatch(/^Finish the authentication/);
    mark = phone.mark();
    phone.send({ type: "utterance", text: "clear the goal" });
    await phone.waitFor((m) => m.type === "goal" && m.goal === null, 8000, mark);
    const sets = t.mockLog().filter((e) => e.method === "thread/goal/set") as { params: Record<string, unknown> }[];
    expect(sets.every((s) => s.params.origin === "user")).toBe(true);
  });

  it("skill invocation sends $name text plus a skill input item", async () => {
    const { t, phone } = await setup();
    const skills = (await phone.waitFor("skills")) as Of<"skills">;
    expect(skills.skills.map((s) => s.name)).toEqual(["execute-plans", "systematic-debugging", "writing-tests"]);
    phone.send({ type: "utterance", text: "use systematic de bugging to investigate the authentication issue" });
    const a = (await phone.waitFor("answer")) as Of<"answer">;
    expect(a.text).toMatch(/^Using systematic-debugging/);
    const input = turnStarts(t)[0]!.params.input;
    expect(input[0]).toMatchObject({ type: "text", text: "$systematic-debugging Investigate the authentication issue." });
    expect(input[1]).toEqual({ type: "skill", name: "systematic-debugging", path: "/mock/skills/systematic-debugging/SKILL.md" });
  });

  it("attach existing thread lists threads by cwd and resumes the chosen one", async () => {
    const seed = JSON.stringify([
      { id: "thread-old-1", cwd: "D:\\work\\lead-tracker", preview: "Fix the import" },
      { id: "thread-other", cwd: "D:\\work\\kernel-labs", preview: "Other project" },
    ]);
    const { t, phone } = await setup({ mockArgs: ["--seed", seed] });
    phone.send({ type: "thread.list", sessionId: "lead-tracker" });
    const th = (await phone.waitFor("threads")) as Of<"threads">;
    expect(th.threads.map((x) => x.id)).toEqual(["thread-old-1"]);
    phone.send({ type: "thread.attach", sessionId: "lead-tracker", threadId: "thread-old-1" });
    await phone.waitFor((m) => m.type === "sessions" && m.sessions.some((s) => s.id === "lead-tracker" && s.threadId === "thread-old-1"));
    phone.send({ type: "prompt.send", sessionId: "lead-tracker", text: "Continue." });
    await phone.waitFor("answer");
    expect(turnStarts(t)[0]!.params.threadId).toBe("thread-old-1");
  });

  it("never sends unsandboxed methods, whatever the phone says", async () => {
    const { t, phone } = await setup();
    phone.send({ type: "command.exec", command: "dir" });
    phone.send({ type: "utterance", text: "run the tests" });
    await phone.waitFor("answer");
    phone.send({ type: "utterance", text: "run shell command del everything" });
    await phone.waitFor((m) => m.type === "answer" && m.text !== undefined, 8000, phone.mark());
    const methods = t.mockLog().map((e) => String(e.method ?? ""));
    expect(methods.some((m) => m === "thread/shellCommand" || m.startsWith("command/exec") || m.startsWith("process/"))).toBe(false);
    expect(turnStarts(t).every((s) => s.params.input[0]!.type === "text")).toBe(true);
  });

  it("restarts a crashed app-server and keeps working", async () => {
    const { phone } = await setup({ mockArgs: ["--crash-after-turns", "1"] });
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "First." });
    await phone.waitFor("answer");
    await phone.waitFor((m) => m.type === "toast" && /isn't responding/.test(m.message));
    const mark = phone.mark();
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "Second." });
    await phone.waitFor("answer", 10_000, mark);
  });
});

describe("listen half: Stop hook, dedupe, audio, copy", () => {
  async function postHook(t: TestCompanion, body: unknown, secret?: string) {
    const { hookSecret } = JSON.parse(readFileSync(join(t.dataDir, "secrets.json"), "utf8")) as { hookSecret: string };
    return fetch(`http://127.0.0.1:${t.c.control.port}/hook/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [HOOK_SECRET_HEADER]: secret ?? hookSecret },
      body: JSON.stringify(body),
    });
  }

  it("dedupes a hook answer against the app-server answer for the same turn", async () => {
    const { t, phone } = await setup();
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "Run the tests." });
    const a = (await phone.waitFor("answer")) as Of<"answer">;
    const res = await postHook(t, { event: "Stop", cwd: "d:/work/SOLE-HARBOR/", turnId: a.turnId, lastAssistantMessage: a.text });
    expect(res.status).toBe(202);
    await sleep(200);
    expect(phone.received.filter((m) => m.type === "answer")).toHaveLength(1);
    expect(t.c.answers.count()).toBe(1);
  });

  it("maps hook cwds to sessions and creates unlisted sessions for unknown folders", async () => {
    const { t, phone } = await setup();
    await postHook(t, { event: "Stop", cwd: "D:\\work\\lead-tracker\\src", turnId: "hook-turn-1", lastAssistantMessage: "Lead import fixed." });
    const a1 = (await phone.waitFor("answer")) as Of<"answer">;
    expect(a1).toMatchObject({ sessionId: "lead-tracker", source: "hook", text: "Lead import fixed." });
    await postHook(t, { event: "Stop", cwd: "E:\\scratch\\demo-app", turnId: "hook-turn-2", lastAssistantMessage: "Demo done." });
    const a2 = (await phone.waitFor((m) => m.type === "answer" && m.turnId === "hook-turn-2")) as Of<"answer">;
    const s = (await phone.waitFor((m) => m.type === "sessions" && m.sessions.some((x) => x.unlisted))) as Of<"sessions">;
    expect(s.sessions.find((x) => x.id === a2.sessionId)).toMatchObject({ name: "demo-app", unlisted: true });
    // Unlisted sessions can be listened to, not prompted.
    phone.send({ type: "prompt.send", sessionId: a2.sessionId, text: "Hi." });
    await phone.waitFor((m) => m.type === "toast" && /only listen/.test(m.message));
  });

  it("a reconnecting phone gets each session's latest answer, not only the 20 newest", async () => {
    const { t, phone } = await setup();
    await postHook(t, { event: "Stop", cwd: "D:\\work\\lead-tracker", turnId: "quiet-1", lastAssistantMessage: "Lead import fixed." });
    for (let i = 0; i < 21; i++) await postHook(t, { event: "Stop", cwd: "D:\\work\\sole-harbor", turnId: "busy-" + i, lastAssistantMessage: "Step " + i + " done." });
    await phone.waitFor((m) => m.type === "answer" && m.turnId === "busy-20");
    const again = await Phone.connect(t);
    phones.push(again);
    await again.waitFor((m) => m.type === "answer" && m.turnId === "quiet-1", 3000);
  });

  it("a failed PC voice render tells the phone instead of hanging", async () => {
    const { t, phone } = await setup();
    await postHook(t, { event: "Stop", cwd: "D:\\work\\sole-harbor", turnId: "tts-1", lastAssistantMessage: "TTSFAIL here." });
    const a = (await phone.waitFor("answer")) as Of<"answer">;
    phone.send({ type: "answer.audioUrl", answerId: a.id });
    await phone.waitFor((m) => m.type === "audio.failed" && m.answerId === a.id);
  });

  it("rejects hook posts without the secret or with a browser Origin", async () => {
    const { t } = await setup();
    expect((await postHook(t, { cwd: "D:\\x", lastAssistantMessage: "x" }, "wrong")).status).toBe(401);
    const res = await fetch(`http://127.0.0.1:${t.c.control.port}/hook/stop`, { method: "POST", headers: { Origin: "https://evil.example" }, body: "{}" });
    expect(res.status).toBe(403);
  });

  it("the real stop-hook.mjs script posts to the companion and prints nothing", async () => {
    const { t, phone } = await setup();
    const payload = {
      session_id: "019a0000-0000-7000-8000-000000000001",
      turn_id: "hook-script-turn",
      cwd: "D:\\work\\kernel-labs",
      hook_event_name: "Stop",
      model: "mock-model",
      permission_mode: "default",
      stop_hook_active: false,
      transcript_path: null,
      last_assistant_message: "Kernel build is green.",
    };
    const child = spawn(process.execPath, [join(REPO_ROOT, "scripts", "hooks", "stop-hook.mjs")], {
      env: { ...process.env, SULTI_DATA_DIR: t.dataDir, SULTI_HOOK_PORT: String(t.c.control.port) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.stdin.end(JSON.stringify(payload));
    const code = await new Promise<number | null>((r) => child.on("exit", r));
    expect(code).toBe(0);
    expect(out).toBe("");
    const a = (await phone.waitFor("answer")) as Of<"answer">;
    expect(a).toMatchObject({ sessionId: "kernel-labs", turnId: "hook-script-turn", text: "Kernel build is green.", source: "hook" });
  });

  it("serves PC-rendered audio through a signed URL with Range support", async () => {
    const { t, phone } = await setup();
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "Run the tests." });
    const a = (await phone.waitFor("answer")) as Of<"answer">;
    phone.send({ type: "answer.audioUrl", answerId: a.id });
    const u = (await phone.waitFor("audio.url")) as Of<"audio.url">;
    expect(u.url).toMatch(/^\/api\/answers\/[\w-]+\/audio\?exp=\d+&sig=/);
    expect(t.rendered[0]).toBe(a.speechText);
    const base = `http://127.0.0.1:${t.c.phone.port}`;
    const full = await fetch(base + u.url);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("audio/wav");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    const part = await fetch(base + u.url, { headers: { Range: "bytes=0-43" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toMatch(/^bytes 0-43\/\d+$/);
    expect((await part.arrayBuffer()).byteLength).toBe(44);
    expect((await fetch(base + u.url.replace(/sig=(.)/, (_, c: string) => "sig=" + (c === "x" ? "y" : "x")))).status).toBe(403);
    expect((await fetch(base + `/api/answers/${a.id}/audio`)).status).toBe(403);
  });

  it("copy to PC uses the clipboard helper with the full answer text", async () => {
    const { t, phone } = await setup();
    phone.send({ type: "prompt.send", sessionId: "sole-harbor", text: "Run the tests." });
    const a = (await phone.waitFor("answer")) as Of<"answer">;
    phone.send({ type: "answer.copyToPc", answerId: a.id });
    await phone.waitFor((m) => m.type === "toast" && /clipboard/.test(m.message));
    expect(t.copied).toEqual([a.text]);
  });
});

describe("pairing and WebSocket auth over the wire", () => {
  it("rejects a WebSocket from a foreign Origin", async () => {
    const t = await startTestCompanion();
    running.push(t);
    await expect(Phone.open(t.c.phone.port, "https://evil.example")).rejects.toThrow(/403/);
  });

  it("closes a socket whose first message is not a valid auth", async () => {
    const t = await startTestCompanion();
    running.push(t);
    const p = await Phone.open(t.c.phone.port);
    p.send({ type: "sessions.list" });
    expect(await waitClose(p.ws)).toBe(4401);
    const q = await Phone.open(t.c.phone.port);
    q.send({ type: "auth", deviceToken: "not-a-real-token-at-all-xxxxxxxx" });
    expect(await waitClose(q.ws)).toBe(4401);
  });

  it("closes an unauthenticated socket after 5 seconds", async () => {
    const t = await startTestCompanion();
    running.push(t);
    const p = await Phone.open(t.c.phone.port);
    const started = Date.now();
    expect(await waitClose(p.ws, 9000)).toBe(4401);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4500);
  }, 12_000);

  it("pairing needs the right Origin and a valid one-time code", async () => {
    const t = await startTestCompanion();
    running.push(t);
    const url = `http://127.0.0.1:${t.c.phone.port}/api/pair`;
    const code = t.c.newPairing().code;
    const bad = await fetch(url, { method: "POST", headers: { Origin: "https://evil.example" }, body: JSON.stringify({ code }) });
    expect(bad.status).toBe(403);
    const ok = await fetch(url, { method: "POST", headers: { Origin: "https://sulti.example" }, body: JSON.stringify({ code }) });
    expect(ok.status).toBe(200);
    const again = await fetch(url, { method: "POST", headers: { Origin: "https://sulti.example" }, body: JSON.stringify({ code }) });
    expect(again.status).toBe(401);
  });

  it("drops a revoked device on its next connection", async () => {
    const t = await startTestCompanion();
    running.push(t);
    const token = await pairDevice(t);
    const first = await Phone.open(t.c.phone.port);
    first.send({ type: "auth", deviceToken: token });
    const auth = (await first.waitFor("auth.ok")) as Of<"auth.ok">;
    expect(auth.host).toBeTruthy();
    first.close();
    expect(t.c.pairing.revoke(auth.deviceId)).toBe(true);
    const second = await Phone.open(t.c.phone.port);
    second.send({ type: "auth", deviceToken: token });
    expect(await waitClose(second.ws)).toBe(4401);
  });

  it("revoking a device also closes its open connection", async () => {
    const t = await startTestCompanion();
    running.push(t);
    const phone = await Phone.connect(t);
    phones.push(phone);
    const auth = phone.received.find((m) => m.type === "auth.ok") as Of<"auth.ok">;
    expect(t.c.pairing.revoke(auth.deviceId)).toBe(true);
    phone.send({ type: "sessions.list" });
    expect(await waitClose(phone.ws)).toBe(4401);
  });
});
