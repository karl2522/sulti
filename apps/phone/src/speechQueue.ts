/**
 * Playback mode A: a chunk queue over the browser's speech synthesizer.
 *
 * No DOM access here. The synthesizer and timers are injected, so the iOS
 * quirks can be tested with a mock:
 *  - every restart calls cancel() first;
 *  - callbacks from a cancelled utterance are ignored (generation counter);
 *  - resume() can stall on iOS, so after resuming we check that speech is
 *    actually running and, if not, cancel and re-speak the current chunk.
 * The "first speak() must follow a tap" rule is handled by the caller, which
 * only starts playback from tap handlers (or after a tap has unlocked speech).
 */

export interface SpeakHandlers {
  onEnd(): void;
  onError(error: string): void;
}

export interface SpeakOptions {
  rate: number;
  voiceName: string | null;
}

export interface Synth {
  speak(text: string, opts: SpeakOptions, handlers: SpeakHandlers): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  readonly speaking: boolean;
  readonly paused: boolean;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export type QueueStatus = "idle" | "playing" | "paused" | "done";

export interface QueueState {
  status: QueueStatus;
  answerId: string | null;
  index: number;
  total: number;
}

export interface QueueOptions {
  onChange?: (state: QueueState) => void;
  timers?: Timers;
  /** How long to wait after resume() before deciding it stalled. */
  stallMs?: number;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Errors that just mean "we cancelled it", not a real failure. */
const CANCEL_ERRORS = new Set(["interrupted", "canceled", "cancelled"]);

export class SpeechQueue {
  rate = 1;
  voiceName: string | null = null;

  private chunks: string[] = [];
  private index = 0;
  private status: QueueStatus = "idle";
  private answerId: string | null = null;
  private gen = 0;
  private stallTimer: unknown = null;
  private readonly timers: Timers;
  private readonly stallMs: number;

  constructor(
    private readonly synth: Synth,
    private readonly opts: QueueOptions = {},
  ) {
    this.timers = opts.timers ?? defaultTimers;
    this.stallMs = opts.stallMs ?? 700;
  }

  get state(): QueueState {
    return { status: this.status, answerId: this.answerId, index: this.index, total: this.chunks.length };
  }

  /** Start reading a new answer from the top. */
  start(answerId: string, chunks: string[]): void {
    this.chunks = chunks.map((c) => c.trim()).filter(Boolean);
    this.answerId = answerId;
    this.index = 0;
    if (!this.chunks.length) {
      this.halt();
      this.set("done");
      return;
    }
    this.speakCurrent(true);
  }

  pause(): void {
    if (this.status !== "playing") return;
    this.clearStall();
    this.synth.pause();
    this.set("paused");
  }

  resume(): void {
    if (this.status !== "paused") return;
    this.set("playing");
    this.synth.resume();
    const gen = this.gen;
    this.clearStall();
    this.stallTimer = this.timers.set(() => {
      this.stallTimer = null;
      if (gen !== this.gen || this.status !== "playing") return;
      // iOS sometimes ignores resume(); the only reliable fix is to re-speak.
      if (this.synth.paused || !this.synth.speaking) this.speakCurrent(true);
    }, this.stallMs);
  }

  /** Read the current answer again from the top. */
  restart(): void {
    if (!this.chunks.length) return;
    this.index = 0;
    this.speakCurrent(true);
  }

  /** Alias used by the "read that again" voice command. */
  again(): void {
    this.restart();
  }

  stop(): void {
    this.halt();
    this.index = 0;
    this.set("idle");
  }

  private speakCurrent(fresh: boolean): void {
    this.clearStall();
    if (fresh) this.synth.cancel();
    const gen = ++this.gen;
    const text = this.chunks[this.index];
    if (text === undefined) {
      this.set("done");
      return;
    }
    this.set("playing");
    this.synth.speak(text, { rate: this.rate, voiceName: this.voiceName }, {
      onEnd: () => {
        if (gen !== this.gen) return;
        this.advance();
      },
      onError: (error) => {
        if (gen !== this.gen) return;
        if (CANCEL_ERRORS.has(error)) return;
        // A chunk the engine can't say shouldn't stop the whole answer.
        this.advance();
      },
    });
  }

  private advance(): void {
    this.index += 1;
    if (this.index >= this.chunks.length) {
      this.index = this.chunks.length;
      this.gen += 1;
      this.set("done");
      return;
    }
    this.speakCurrent(false);
  }

  private halt(): void {
    this.gen += 1;
    this.clearStall();
    this.synth.cancel();
  }

  private clearStall(): void {
    if (this.stallTimer !== null) this.timers.clear(this.stallTimer);
    this.stallTimer = null;
  }

  private set(status: QueueStatus): void {
    this.status = status;
    this.opts.onChange?.(this.state);
  }
}
