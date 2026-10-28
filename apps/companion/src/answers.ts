import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { toSpeechText, type Answer, type AnswerSource } from "@sulti/core";
import { writeJson } from "./store.js";

export const MAX_ANSWERS = 200;

/** answers/<id>.json, newest last, capped at MAX_ANSWERS. Dedupes by turn id. */
export class AnswerStore {
  readonly dir: string;
  private answers: Answer[] = [];
  private readonly turnIds = new Set<string>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, "answers");
    mkdirSync(this.dir, { recursive: true });
    for (const f of readdirSync(this.dir).filter((n) => n.endsWith(".json"))) {
      try {
        const a = JSON.parse(readFileSync(join(this.dir, f), "utf8")) as Answer;
        this.answers.push(a);
        if (a.turnId) this.turnIds.add(a.turnId);
      } catch {
        // ignore unreadable files
      }
    }
    this.answers.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Store a new answer, or return null if this turn was already stored (hook vs app-server). */
  add(input: { sessionId: string; turnId: string; text: string; source: AnswerSource }, now = Date.now()): Answer | null {
    const text = input.text.trim();
    if (!text) return null;
    if (input.turnId && this.turnIds.has(input.turnId)) return null;
    const answer: Answer = {
      id: randomUUID(),
      sessionId: input.sessionId,
      turnId: input.turnId,
      text,
      speechText: toSpeechText(text),
      createdAt: now,
      source: input.source,
    };
    if (answer.turnId) this.turnIds.add(answer.turnId);
    this.answers.push(answer);
    writeJson(join(this.dir, answer.id + ".json"), answer);
    this.prune();
    return answer;
  }

  get(id: string): Answer | undefined {
    return this.answers.find((a) => a.id === id);
  }

  recent(limit = 20, sessionId?: string): Answer[] {
    const list = sessionId ? this.answers.filter((a) => a.sessionId === sessionId) : this.answers;
    return list.slice(-limit);
  }

  count(): number {
    return this.answers.length;
  }

  private prune(): void {
    while (this.answers.length > MAX_ANSWERS) {
      const old = this.answers.shift()!;
      for (const suffix of [".json", ".wav", ".code.wav"]) rmSync(join(this.dir, old.id + suffix), { force: true });
    }
  }

  /** Path of a cached audio file if it exists. */
  audioPath(id: string, readCode = false): string {
    return join(this.dir, id + (readCode ? ".code.wav" : ".wav"));
  }

  hasAudio(id: string, readCode = false): boolean {
    try {
      return statSync(this.audioPath(id, readCode)).size > 44;
    } catch {
      return false;
    }
  }
}
