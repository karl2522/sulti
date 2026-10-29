import type { SessionInfo } from "@sulti/core";
import { describe, expect, it } from "vitest";
import { clock, firstLine, initials, span, viewSession } from "./present.js";
import { initialState, type AppState } from "./state.js";

const S = (over: Partial<SessionInfo> = {}): SessionInfo => ({ id: "kernel-labs", name: "Kernel Labs", aliases: [], status: "idle", unlisted: false, threadId: null, ...over });
const T = 1_790_000_000_000;
const answer = { id: "a1", sessionId: "kernel-labs", turnId: "t", text: "I found the **checkout** bug.", speechText: "", createdAt: T, source: "hook" as const };
const state = (over: Partial<AppState> = {}): AppState => ({ ...initialState, ...over });

describe("session presentation", () => {
  it("puts a pending approval first, with its command", () => {
    const approval = { type: "approval.request" as const, requestId: "r", sessionId: "kernel-labs", kind: "command" as const, summary: "Run: npm i", command: "npm install date-fns", receivedAt: 1 };
    const v = viewSession(state({ approvals: [approval], answers: [answer] }), S({ status: "waitingApproval" }), new Set(), null);
    expect(v).toMatchObject({ tone: "coral", label: "Needs approval", detail: "npm install date-fns", detailMono: true, needsYou: true });
  });

  it("shows unheard answers as ready, then quiet once heard", () => {
    const now = T + 12 * 60_000;
    expect(viewSession(state({ answers: [answer] }), S(), new Set(), null, now)).toMatchObject({ label: "Answer ready", detail: "From a terminal, 12 min ago", needsYou: true });
    expect(viewSession(state({ answers: [answer] }), S(), new Set(["a1"]), null, now)).toMatchObject({ label: "Idle", detail: "I found the checkout bug.", needsYou: false });
  });

  it("describes work in progress with the goal or the latest activity", () => {
    const now = 2_000_000;
    const working = S({ status: "working", since: now - 72_000 });
    expect(viewSession(state(), working, new Set(), null, now)).toMatchObject({ tone: "lilac", label: "Working for 1 min" });
    const act = { activity: { "kernel-labs": [{ id: "c", kind: "command" as const, text: "npm test", status: "running" as const, at: 1 }] } };
    expect(viewSession(state(act), working, new Set(), null, now).detail).toBe("Running npm test");
  });

  it("formats names and times", () => {
    expect(initials("Kernel Labs")).toBe("KL");
    expect(initials("invoice-sync")).toBe("IS");
    expect(initials("sulti")).toBe("SU");
    expect(span(72)).toBe("1 min 12 s");
    expect(span(3 * 3600 + 300)).toBe("3 h 5 min");
    expect(clock(134)).toBe("2:14");
  });

  it("turns markdown into a readable one-line snippet", () => {
    expect(firstLine("The tests pass.\n\n## What I checked\n- Ran `npm test`\n- **All** good")).toBe("The tests pass. What I checked. Ran npm test. All good");
  });
});
