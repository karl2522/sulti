import { describe, expect, it } from "vitest";
import { fixtureMessages, type FixtureName } from "../../../test/fixtures/load.js";
import { TurnTracker } from "./turns.js";

function outcome(name: FixtureName, vars: Record<string, string> = {}) {
  const t = new TurnTracker();
  const outs = fixtureMessages(name, vars).map((m) => t.feed(m.method ?? "", m.params)).filter(Boolean);
  expect(outs).toHaveLength(1);
  return outs[0]!;
}

describe("final-answer extraction from recorded app-server events", () => {
  it("normal turn: picks the final_answer, not the commentary", () => {
    const o = outcome("normal");
    expect(o).toMatchObject({ kind: "answer", threadId: "thread-0001", turnId: "turn-0001" });
    expect(o.kind === "answer" && o.text).toMatch(/^The checkout tests pass\.\n\n## What I checked/);
    expect(o.kind === "answer" && o.text).not.toContain("I will run the test suite first.");
  });

  it("interrupted turn: nothing to read", () => {
    expect(outcome("interrupted")).toEqual({ kind: "interrupted", threadId: "thread-0001", turnId: "turn-0001" });
  });

  it("failed turn: speakable usage-limit message", () => {
    expect(outcome("failed-usage-limit")).toEqual({ kind: "failed", threadId: "thread-0001", turnId: "turn-0001", message: "Codex hit its usage limit. Try again later." });
  });

  it("approval turn: answer depends on the decision", () => {
    expect(outcome("approval", { decision: "accept" })).toMatchObject({ kind: "answer", text: "I ran the test suite: 12 tests passed." });
    expect(outcome("approval", { decision: "decline" })).toMatchObject({ kind: "answer", text: "You declined the test run, so I did not run anything." });
  });

  it("skill turn", () => {
    expect(outcome("skill")).toMatchObject({ kind: "answer", text: expect.stringMatching(/^Using systematic-debugging/) });
  });

  it("no phase: falls back to the last agent message", () => {
    expect(outcome("no-phase")).toMatchObject({ kind: "answer", text: "The lead import works now." });
  });

  it("uses turn.items from turn/completed when item events were missed", () => {
    const t = new TurnTracker();
    const out = t.feed("turn/completed", {
      threadId: "a",
      turn: { id: "b", status: "completed", items: [{ type: "agentMessage", id: "m", text: "PONG", phase: "final_answer" }] },
    });
    expect(out).toEqual({ kind: "answer", threadId: "a", turnId: "b", text: "PONG" });
  });

  it("keeps turns separate and reports empty turns", () => {
    const t = new TurnTracker();
    t.feed("item/completed", { turnId: "x", item: { type: "agentMessage", id: "1", text: "for x", phase: "final_answer" } });
    expect(t.feed("turn/completed", { threadId: "a", turn: { id: "y", status: "completed", items: [] } })).toMatchObject({ kind: "empty", turnId: "y" });
    expect(t.feed("turn/completed", { threadId: "a", turn: { id: "x", status: "completed", items: [] } })).toMatchObject({ kind: "answer", text: "for x" });
  });
});
