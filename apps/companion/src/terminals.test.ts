import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionRegistry, parseSessions } from "./sessions.js";
import { STALE_MS, TerminalWatcher } from "./terminals.js";

const CWD = "C:\\work\\app";
const meta = (source: unknown = "cli", cwd = CWD) => JSON.stringify({ timestamp: "2026-11-05T01:00:00.000Z", type: "session_meta", payload: { id: "x", cwd, source, base_instructions: { text: "a".repeat(5000) } } }) + "\n";
const ev = (type: string, at = "2026-11-05T01:00:05.000Z") => JSON.stringify({ timestamp: at, ordinal: 1, type: "event_msg", payload: { type, turn_id: "t1" } }) + "\n";
const msg = (text: string) => JSON.stringify({ timestamp: "2026-11-05T01:00:06.000Z", type: "response_item", payload: { type: "message", text } }) + "\n";

function setup(now = () => Date.now()) {
  const root = mkdtempSync(join(tmpdir(), "sulti-codex-"));
  mkdirSync(join(root, "2026", "11", "05"), { recursive: true });
  const changes: Map<string, number>[] = [];
  const w = new TerminalWatcher(root, (t) => changes.push(t), undefined, now);
  const file = (name = "rollout-a.jsonl") => join(root, "2026", "11", "05", name);
  return { root, w, changes, file };
}

describe("terminal turns from Codex session logs", () => {
  it("reports a running turn with its start time, and clears it when the turn ends", () => {
    const { w, changes, file } = setup();
    writeFileSync(file(), meta() + ev("task_started"));
    w.refresh();
    expect(w.turns()).toEqual(new Map([[CWD, Date.parse("2026-11-05T01:00:05.000Z")]]));
    appendFileSync(file(), msg("working") + ev("task_complete"));
    w.refresh();
    expect(w.turns().size).toBe(0);
    appendFileSync(file(), ev("task_started") + ev("turn_aborted"));
    w.refresh();
    expect(w.turns().size).toBe(0);
    expect(changes.map((c) => c.size)).toEqual([1, 0]); // only real changes are reported
  });

  it("ignores turn events quoted inside a message, and lines still being written", () => {
    const { w, file } = setup();
    writeFileSync(file(), meta() + msg('{"timestamp":"x","type":"event_msg","payload":{"type":"task_started"}}'));
    w.refresh();
    expect(w.turns().size).toBe(0);
    appendFileSync(file(), ev("task_started").slice(0, 60));
    w.refresh();
    expect(w.turns().size).toBe(0);
    appendFileSync(file(), ev("task_started").slice(60));
    w.refresh();
    expect(w.turns().size).toBe(1);
  });

  it("skips subagents and codex exec, and expires a turn that went quiet", () => {
    let now = Date.now();
    const { w, file } = setup(() => now);
    writeFileSync(file("sub.jsonl"), meta({ subagent: "review" }) + ev("task_started"));
    writeFileSync(file("exec.jsonl"), meta("exec") + ev("task_started"));
    writeFileSync(file(), meta() + ev("task_started"));
    w.refresh();
    expect([...w.turns().keys()]).toEqual([CWD]);
    now += STALE_MS + 1000;
    w.refresh();
    expect(w.turns().size).toBe(0);
  });

  it("picks up an old log again when it is resumed", () => {
    const { w, file } = setup();
    writeFileSync(file(), meta() + ev("task_started") + ev("task_complete"));
    const old = (Date.now() - 2 * STALE_MS) / 1000;
    utimesSync(file(), old, old);
    w.refresh();
    appendFileSync(file(), ev("task_started", new Date().toISOString()));
    w.refresh();
    expect(w.turns().size).toBe(1);
  });
});

describe("session status with terminal turns", () => {
  it("shows a terminal turn as working without taking over Sulti's own state", () => {
    const r = new SessionRegistry(parseSessions({ sessions: [{ name: "App", cwd: CWD }] }));
    expect(r.setTerminal("app", 1000)).toBe(true);
    expect(r.info("app", null)).toMatchObject({ status: "working", terminal: true, since: 1000 });
    expect(r.setStatus("app", "working")).toBe(true); // Sulti's own turn starts: no longer terminal-only
    expect(r.info("app", null)?.terminal).toBe(false);
    expect(r.setStatus("app", "idle")).toBe(true); // Sulti's turn ends, the terminal's goes on
    expect(r.info("app", null)).toMatchObject({ status: "working", terminal: true, since: 1000 });
    expect(r.setTerminal("app", null)).toBe(true);
    expect(r.getStatus("app")).toBe("idle");
    expect(r.setTerminal("app", null)).toBe(false);
  });
});
