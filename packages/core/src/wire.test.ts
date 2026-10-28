import { describe, expect, it } from "vitest";
import { MAX_GOAL_OBJECTIVE, parseCompanionMessage, parsePhoneMessage } from "./wire.js";

describe("wire contract", () => {
  it("accepts a valid phone prompt", () => {
    const msg = parsePhoneMessage(JSON.stringify({ type: "prompt.send", sessionId: "sole-harbor", text: "Run the tests." }));
    expect(msg).toEqual({ type: "prompt.send", sessionId: "sole-harbor", text: "Run the tests." });
  });

  it("rejects unknown types, bad JSON, and bad decisions", () => {
    expect(parsePhoneMessage("{")).toBeNull();
    expect(parsePhoneMessage(JSON.stringify({ type: "shell.exec", command: "dir" }))).toBeNull();
    expect(parsePhoneMessage(JSON.stringify({ type: "approval.respond", requestId: "1", decision: "yolo" }))).toBeNull();
  });

  it("enforces the goal objective limits", () => {
    const make = (objective: string) => JSON.stringify({ type: "goal.set", sessionId: "s", objective });
    expect(parsePhoneMessage(make("   "))).toBeNull();
    expect(parsePhoneMessage(make("x".repeat(MAX_GOAL_OBJECTIVE + 1)))).toBeNull();
    expect(parsePhoneMessage(make("x".repeat(MAX_GOAL_OBJECTIVE)))).not.toBeNull();
  });

  it("round-trips a companion answer", () => {
    const answer = {
      type: "answer",
      id: "a1",
      sessionId: "lead-tracker",
      turnId: "t1",
      text: "Done.",
      speechText: "Done.",
      createdAt: 1,
      source: "hook",
    };
    expect(parseCompanionMessage(JSON.stringify(answer))).toEqual(answer);
  });
});
