import { describe, expect, it } from "vitest";
import { parseStopHookBody } from "../../apps/companion/src/listen/hook.js";
import { dataDir, extractStop, parseInput } from "../../scripts/hooks/stop-hook.mjs";

// Field set observed from Codex 0.165.0 on Windows (docs/PROTOCOL_NOTES.md); values are fictional.
const STOP = {
  session_id: "019a0000-0000-7000-8000-000000000001",
  transcript_path: null,
  cwd: "D:\\work\\sole-harbor",
  hook_event_name: "Stop",
  model: "mock-model",
  permission_mode: "default",
  stop_hook_active: false,
  turn_id: "019a0000-0000-7000-8000-000000000002",
  last_assistant_message: "PONG",
};

describe("Stop-hook payload parsing (hook script)", () => {
  it("reads the Codex Stop payload from stdin", () => {
    expect(extractStop(parseInput(JSON.stringify(STOP), []))).toEqual({
      event: "Stop",
      cwd: "D:\\work\\sole-harbor",
      sessionId: STOP.session_id,
      turnId: STOP.turn_id,
      lastAssistantMessage: "PONG",
    });
  });

  it("falls back to the legacy notify JSON in the last argv argument", () => {
    const notify = { type: "agent-turn-complete", "thread-id": "t1", "turn-id": "u1", cwd: "D:\\work\\lead-tracker", "last-assistant-message": "Done." };
    expect(extractStop(parseInput("", ["--debug", JSON.stringify(notify)]))).toEqual({
      event: "agent-turn-complete",
      cwd: "D:\\work\\lead-tracker",
      sessionId: "t1",
      turnId: "u1",
      lastAssistantMessage: "Done.",
    });
  });

  it("ignores other events, junk, and payloads without a cwd", () => {
    expect(extractStop({ ...STOP, hook_event_name: "SessionStart" })).toBeNull();
    expect(extractStop({ ...STOP, cwd: undefined })).toBeNull();
    expect(extractStop(null)).toBeNull();
    expect(parseInput("not json", ["also not json"])).toBeNull();
  });

  it("keeps a null last_assistant_message as null", () => {
    expect(extractStop({ ...STOP, last_assistant_message: null })?.lastAssistantMessage).toBeNull();
  });

  it("uses %APPDATA%\\sulti unless SULTI_DATA_DIR is set", () => {
    expect(dataDir({ APPDATA: "D:\\AppData\\Roaming" })).toMatch(/[\\/]sulti$/);
    expect(dataDir({ SULTI_DATA_DIR: "D:\\data", APPDATA: "x" })).toBe("D:\\data");
  });
});

describe("Stop-hook body validation (companion)", () => {
  it("accepts a normalized body", () => {
    expect(parseStopHookBody({ event: "Stop", cwd: "D:\\x", sessionId: "s", turnId: "t", lastAssistantMessage: " Hi " })).toEqual({
      ok: true,
      cwd: "D:\\x",
      sessionId: "s",
      turnId: "t",
      message: "Hi",
    });
  });

  it("rejects empty messages, other events and bad shapes", () => {
    expect(parseStopHookBody({ cwd: "D:\\x", lastAssistantMessage: "  " })).toMatchObject({ ok: false });
    expect(parseStopHookBody({ event: "PreToolUse", cwd: "D:\\x", lastAssistantMessage: "x" })).toMatchObject({ ok: false });
    expect(parseStopHookBody({ cwd: 3 })).toMatchObject({ ok: false });
    expect(parseStopHookBody(null)).toMatchObject({ ok: false });
  });
});
