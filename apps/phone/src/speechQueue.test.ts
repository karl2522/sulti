import { describe, expect, it } from "vitest";
import { SpeechQueue, type SpeakHandlers, type Synth, type Timers } from "./speechQueue.js";

class MockSynth implements Synth {
  log: string[] = [];
  spoken: { text: string; h: SpeakHandlers }[] = [];
  speaking = false;
  paused = false;
  /** When false, resume() does nothing (the iOS stall). */
  resumeWorks = true;

  speak(text: string, _o: unknown, h: SpeakHandlers): void {
    this.log.push(`speak:${text}`);
    this.spoken.push({ text, h });
    this.speaking = true;
    this.paused = false;
  }
  cancel(): void {
    this.log.push("cancel");
    this.speaking = false;
    this.paused = false;
  }
  pause(): void {
    this.log.push("pause");
    this.paused = true;
  }
  resume(): void {
    this.log.push("resume");
    if (this.resumeWorks) this.paused = false;
  }
  /** Finish the most recent utterance. */
  end(i = this.spoken.length - 1): void {
    this.speaking = false;
    this.spoken[i]!.h.onEnd();
  }
}

class ManualTimers implements Timers {
  pending = new Map<number, () => void>();
  private next = 1;
  set(fn: () => void): unknown {
    const id = this.next++;
    this.pending.set(id, fn);
    return id;
  }
  clear(h: unknown): void {
    this.pending.delete(h as number);
  }
  flush(): void {
    const fns = [...this.pending.values()];
    this.pending.clear();
    for (const fn of fns) fn();
  }
}

function setup() {
  const synth = new MockSynth();
  const timers = new ManualTimers();
  const q = new SpeechQueue(synth, { timers });
  return { synth, timers, q };
}

describe("SpeechQueue", () => {
  it("reads chunks in order and finishes", () => {
    const { synth, q } = setup();
    q.start("a1", ["One.", "Two.", "Three."]);
    synth.end();
    synth.end();
    expect(q.state.status).toBe("playing");
    synth.end();
    expect(synth.spoken.map((s) => s.text)).toEqual(["One.", "Two.", "Three."]);
    expect(q.state).toEqual({ status: "done", answerId: "a1", index: 3, total: 3 });
  });

  it("cancels before starting and before every restart", () => {
    const { synth, q } = setup();
    q.start("a1", ["One.", "Two."]);
    synth.end();
    q.restart();
    expect(synth.log).toEqual(["cancel", "speak:One.", "speak:Two.", "cancel", "speak:One."]);
  });

  it("ignores callbacks from a cancelled utterance", () => {
    const { synth, q } = setup();
    q.start("a1", ["One.", "Two."]);
    q.restart(); // cancels the first "One."
    synth.spoken[0]!.h.onError("interrupted");
    synth.spoken[0]!.h.onEnd();
    expect(q.state.index).toBe(0);
    expect(synth.spoken).toHaveLength(2);
  });

  it("re-speaks the current chunk when resume() stalls", () => {
    const { synth, timers, q } = setup();
    q.start("a1", ["One.", "Two."]);
    synth.end();
    q.pause();
    synth.resumeWorks = false;
    q.resume();
    timers.flush();
    expect(synth.log.slice(-4)).toEqual(["pause", "resume", "cancel", "speak:Two."]);
    expect(q.state).toMatchObject({ status: "playing", index: 1 });
  });

  it("leaves a working resume alone", () => {
    const { synth, timers, q } = setup();
    q.start("a1", ["One."]);
    q.pause();
    q.resume();
    timers.flush();
    expect(synth.log).toEqual(["cancel", "speak:One.", "pause", "resume"]);
  });

  it("stop cancels speech and ignores late callbacks", () => {
    const { synth, q } = setup();
    q.start("a1", ["One.", "Two."]);
    q.stop();
    synth.spoken[0]!.h.onEnd();
    expect(q.state).toMatchObject({ status: "idle", index: 0 });
    expect(synth.spoken).toHaveLength(1);
  });

  it("skips a chunk the engine fails on", () => {
    const { synth, q } = setup();
    q.start("a1", ["One.", "Two."]);
    synth.spoken[0]!.h.onError("synthesis-failed");
    expect(synth.spoken.map((s) => s.text)).toEqual(["One.", "Two."]);
  });

  it("passes rate and voice through and drops blank chunks", () => {
    const seen: unknown[] = [];
    const synth = new MockSynth();
    synth.speak = (t, o) => {
      seen.push([t, o]);
    };
    const q = new SpeechQueue(synth);
    q.rate = 1.3;
    q.voiceName = "Samantha";
    q.start("a1", ["  ", "Hi."]);
    expect(seen).toEqual([["Hi.", { rate: 1.3, voiceName: "Samantha" }]]);
  });

  it("starts mid-answer and jumps between sentences, cancelling first", () => {
    const { synth, q } = setup();
    q.start("a1", ["One.", "Two.", "Three."], 1);
    expect(q.state).toMatchObject({ status: "playing", index: 1 });
    q.jump(9);
    expect(q.state.index).toBe(2);
    synth.spoken[0]!.h.onEnd(); // stale "Two." ending must not advance
    expect(q.state.index).toBe(2);
    expect(synth.log).toEqual(["cancel", "speak:Two.", "cancel", "speak:Three."]);
  });
});
