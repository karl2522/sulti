import type { Intent } from "@sulti/core";
import { describe, expect, it } from "vitest";
import { planRoute, type RouteResult } from "./routePlan.js";

const meta = { confidence: 0.9, needsConfirm: false };
const result = (intent: Intent, needsConfirm = intent.needsConfirm): RouteResult => ({
  type: "route.result",
  routeId: "r1",
  intent,
  echo: "→ Kernel Labs: Run the tests.",
  needsConfirm,
});

describe("planRoute", () => {
  it("treats confident prompts and Codex actions as already executed", () => {
    expect(planRoute(result({ kind: "prompt", sessionId: "kernel-labs", text: "Run the tests.", ...meta })).kind).toBe("done");
    expect(planRoute(result({ kind: "codex", sessionId: "kernel-labs", action: { type: "interrupt" }, ...meta })).kind).toBe("done");
  });

  it("asks before running an unsure prompt", () => {
    const plan = planRoute(result({ kind: "prompt", sessionId: "kernel-labs", text: "Run the tests.", confidence: 0.5, needsConfirm: true }));
    expect(plan).toEqual({ kind: "confirm", routeId: "r1", echo: "→ Kernel Labs: Run the tests." });
  });

  it("lets the hub switch sessions it resolved", () => {
    const intent: Intent = { kind: "app", action: { type: "switchSession", sessionId: "sole-harbor", spoken: "sole harbor" }, ...meta };
    expect(planRoute(result(intent)).kind).toBe("done");
    expect(planRoute(result({ ...intent, needsConfirm: true })).kind).toBe("confirm");
  });

  it("opens the picker when no session matched, without a route.confirm", () => {
    const plan = planRoute(result({ kind: "app", action: { type: "switchSession", sessionId: null, spoken: "lead trucker" }, confidence: 0.3, needsConfirm: true }));
    expect(plan).toMatchObject({ kind: "pickSession", spoken: "lead trucker" });
  });

  it("runs playback, copy and approvals on the phone", () => {
    const plan = planRoute(result({ kind: "app", action: { type: "playback", playback: "pause" }, ...meta }));
    expect(plan).toMatchObject({ kind: "local", action: { type: "playback", playback: "pause" }, confirm: false });
    const copy = planRoute(result({ kind: "app", action: { type: "copy", target: "pc" }, confidence: 0.6, needsConfirm: true }));
    expect(copy).toMatchObject({ kind: "local", routeId: "r1", confirm: true });
  });
});
