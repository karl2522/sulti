import { describe, expect, it } from "vitest";
import { route, type RouteContext } from "./router.js";

// Section 9 test corpus (fictional names only).
const ctx: RouteContext = {
  sessions: [
    { id: "sole-harbor", name: "Sole Harbor", aliases: ["soul harbor"] },
    { id: "lead-tracker", name: "Lead Tracker", aliases: ["led tracker"] },
    { id: "kernel-labs", name: "Kernel Labs", aliases: ["colonel labs"] },
  ],
  skills: [{ name: "execute-plans" }, { name: "systematic-debugging" }, { name: "writing-tests" }],
  activeSessionId: "sole-harbor",
};
const r = (u: string, c: RouteContext = ctx) => route(u, c);

describe("intent router: Section 9 corpus", () => {
  it('"switch to soul harbor" -> app switch to Sole Harbor', () => {
    const out = r("switch to soul harbor");
    expect(out.intent).toMatchObject({ kind: "app", action: { type: "switchSession", sessionId: "sole-harbor" }, needsConfirm: false });
  });

  it("keeps a typed prompt's line breaks exactly, after any session prefix", () => {
    const pasted = "fix this error:\nTypeError: x is undefined\n    at cart.ts:12";
    expect(r(pasted).intent).toMatchObject({ kind: "prompt", text: pasted });
    expect(r("in kernel labs " + pasted).intent).toMatchObject({ sessionId: "kernel-labs", text: pasted });
  });

  it("stays fast on a long prompt that starts like a skill command", () => {
    const many = { ...ctx, skills: Array.from({ length: 150 }, (_, i) => ({ name: "skill-name-number-" + i })) };
    const long = "use the existing helper to " + "refactor the cart totals so they are cached ".repeat(15);
    const t = performance.now();
    r(long, many);
    expect(performance.now() - t).toBeLessThan(500); // was ~6 s before the span cap
  });

  it('"/new" starts a fresh chat, keeping any first prompt as typed', () => {
    expect(r("/new").intent).toMatchObject({ kind: "codex", sessionId: "sole-harbor", action: { type: "thread.new" } });
    expect(r("/new fix the login bug").intent).toMatchObject({ kind: "codex", action: { type: "thread.new", text: "fix the login bug" } });
    expect(r("in kernel labs start a new chat").intent).toMatchObject({ kind: "codex", sessionId: "kernel-labs", action: { type: "thread.new" } });
    expect(r("/newer things").intent).not.toMatchObject({ action: { type: "thread.new" } });
  });

  it('"tell led tracker to ..." -> prompt Lead Tracker with sentence cleanup', () => {
    const out = r("tell led tracker to investigate the checkout problem don't modify anything yet");
    expect(out.intent).toEqual({
      kind: "prompt",
      sessionId: "lead-tracker",
      text: "Investigate the checkout problem. Don't modify anything yet.",
      confidence: expect.any(Number),
      needsConfirm: false,
    });
    expect(out.echo).toBe("→ Lead Tracker: Investigate the checkout problem. Don't modify anything yet.");
  });

  it('"use execute planes" -> skill execute-plans on the active session', () => {
    expect(r("use execute planes").intent).toMatchObject({ kind: "codex", sessionId: "sole-harbor", action: { type: "skill", skill: "execute-plans" } });
    expect(r("use execute planes").intent).not.toHaveProperty("action.text");
  });

  it('"use systematic de bugging to ..." -> skill with text', () => {
    expect(r("use systematic de bugging to investigate the authentication issue").intent).toMatchObject({
      kind: "codex",
      sessionId: "sole-harbor",
      action: { type: "skill", skill: "systematic-debugging", text: "Investigate the authentication issue." },
      needsConfirm: false,
    });
  });

  it('"set the goal to ..." -> goal.set', () => {
    expect(r("set the goal to finish the authentication migration and make all tests pass").intent).toMatchObject({
      kind: "codex",
      sessionId: "sole-harbor",
      action: { type: "goal.set", objective: "Finish the authentication migration and make all tests pass." },
    });
  });

  it.each([
    ["what's the current goal", { type: "goal.get" }],
    ["pause the goal", { type: "goal.update", status: "paused" }],
    ["resume the goal", { type: "goal.update", status: "active" }],
    ["clear the goal", { type: "goal.clear" }],
    ["stop codex", { type: "interrupt" }],
  ])('"%s" -> codex %o', (u, action) => {
    expect(r(u).intent).toMatchObject({ kind: "codex", sessionId: "sole-harbor", action });
  });

  it.each([
    ["read the response", "read"],
    ["read it again", "again"],
    ["pause", "pause"],
    ["resume", "resume"],
    ["start over", "restart"],
  ])('"%s" -> app playback %s', (u, playback) => {
    expect(r(u).intent).toMatchObject({ kind: "app", action: { type: "playback", playback } });
  });

  it('"copy the response" -> app copy, ask phone or PC', () => {
    expect(r("copy the response").intent).toMatchObject({ kind: "app", action: { type: "copy", target: "ask" } });
    expect(r("copy the response").echo).toBe("Copy to phone or PC?");
  });

  it('"run the tests" -> a prompt to the active session, never a shell command', () => {
    expect(r("run the tests").intent).toEqual({ kind: "prompt", sessionId: "sole-harbor", text: "Run the tests.", confidence: 1, needsConfirm: false });
  });

  it('"in colonel labs run the tests" -> prompt Kernel Labs', () => {
    expect(r("in colonel labs run the tests").intent).toMatchObject({ kind: "prompt", sessionId: "kernel-labs", text: "Run the tests." });
  });

  it.each(["approve", "yes do it", "Yes, do it.", "go ahead"])('"%s" never approves; shows pending approvals', (u) => {
    expect(r(u).intent).toMatchObject({ kind: "app", action: { type: "showApprovals" } });
  });

  it('"switch to bananas" -> needsConfirm / no session named bananas', () => {
    const out = r("switch to bananas");
    expect(out.intent).toMatchObject({ kind: "app", action: { type: "switchSession", sessionId: null }, needsConfirm: true });
    expect(out.echo).toBe("No session named bananas");
  });
});

describe("intent router: extra cases", () => {
  it("uses the active session from context", () => {
    expect(r("run the tests", { ...ctx, activeSessionId: "kernel-labs" }).intent).toMatchObject({ sessionId: "kernel-labs" });
  });

  it("accepts exact session names and punctuation from dictation", () => {
    expect(r("Switch to Kernel Labs.").intent).toMatchObject({ action: { sessionId: "kernel-labs" } });
    expect(r("Tell Lead Tracker to run the tests.").intent).toMatchObject({ kind: "prompt", sessionId: "lead-tracker", text: "Run the tests." });
  });

  it("applies a session prefix to Codex commands", () => {
    expect(r("in kernel labs stop codex").intent).toMatchObject({ kind: "codex", sessionId: "kernel-labs", action: { type: "interrupt" } });
    expect(r("in lead tracker, set the goal to ship v2").intent).toMatchObject({ sessionId: "lead-tracker", action: { type: "goal.set", objective: "Ship v2." } });
  });

  it("does not treat ordinary prompts that start with routing words as routing", () => {
    expect(r("in the tests folder add a smoke test").intent).toMatchObject({ kind: "prompt", sessionId: "sole-harbor", text: "In the tests folder add a smoke test." });
    expect(r("tell me why the build failed").intent).toMatchObject({ kind: "prompt", sessionId: "sole-harbor" });
    expect(r("go to the payments module and explain it").intent).toMatchObject({ kind: "prompt" });
  });

  it("asks for confirmation on a weak session match", () => {
    const out = r("switch to lead track");
    expect(out.intent).toMatchObject({ action: { type: "switchSession", sessionId: "lead-tracker" } });
  });

  it("returns no intent when there is no active session for a prompt", () => {
    expect(r("run the tests", { ...ctx, activeSessionId: null }).intent).toBeNull();
  });

  it("strips filler words from prompts", () => {
    expect(r("um like run the tests").intent).toMatchObject({ text: "Run the tests." });
  });

  it("turns questions into questions", () => {
    expect(r("what changed in the last commit").intent).toMatchObject({ text: "What changed in the last commit?" });
  });

  it("caps goal objectives at 4000 characters", () => {
    const out = r("set the goal to " + "word ".repeat(1200));
    expect(out.intent?.kind === "codex" && out.intent.action.type === "goal.set" && out.intent.action.objective.length).toBeLessThanOrEqual(4000);
  });
});
