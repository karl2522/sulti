import { chunkSpeech, toSpeechText } from "@sulti/core";

/**
 * An answer as something to read along with: blocks to display, and the
 * sentence-sized units the speech queue plays. Every queue chunk maps back to
 * the unit (sentence or code block) it came from, so the reader can highlight
 * what is being spoken and jump to any sentence.
 */
export interface Unit {
  /** Display text (markdown links and emphasis removed, `inline code` kept). */
  text: string;
  speech: string;
}

export type Block =
  | { kind: "text"; tag: "p" | "h" | "li"; units: number[] }
  | { kind: "code"; lang: string; lines: string[]; unit: number };

export interface Reading {
  blocks: Block[];
  units: Unit[];
  /** What the speech queue plays, in order. */
  chunks: string[];
  /** chunks[i] belongs to units[chunkUnit[i]]. */
  chunkUnit: number[];
  /** firstChunk[u] is the first chunk of unit u. */
  firstChunk: number[];
  /** Speech characters before each unit, for time estimates and seeking. */
  offsets: number[];
  totalChars: number;
}

const SENTENCE_END = /(?<=[.!?…])\s+(?=["'“‘(`*_[]?[A-Z0-9])/;

/** Remove markdown decoration a reader shouldn't see; keep inline code. */
export function plain(md: string): string {
  return md
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildReading(markdown: string, readCodeBlocks = false): Reading {
  const blocks: Block[] = [];
  const units: Unit[] = [];
  const addText = (tag: "p" | "h" | "li", md: string) => {
    const ids: number[] = [];
    for (const s of plain(md).split(SENTENCE_END)) {
      const speech = toSpeechText(s);
      if (!s || !speech) continue;
      ids.push(units.push({ text: s, speech }) - 1);
    }
    if (ids.length) blocks.push({ kind: "text", tag, units: ids });
  };
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) addText("p", para.join(" "));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(```|~~~)\s*([\w.+-]*)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!);
      const speech = toSpeechText(["```", ...body, "```"].join("\n"), { readCodeBlocks });
      const unit = units.push({ text: "", speech }) - 1;
      blocks.push({ kind: "code", lang: fence[2] ?? "", lines: body, unit });
      continue;
    }
    if (!line.trim() || /^\s*([-*_])\s*(\1\s*){2,}$/.test(line) || /^\s*\|?\s*:?-{2,}/.test(line)) {
      flush();
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (heading || item) {
      flush();
      addText(heading ? "h" : "li", (heading ?? item)![1]!);
    } else if (/^\s*\|/.test(line)) {
      flush();
      addText("p", line.split("|").map((c) => c.trim()).filter(Boolean).join(", "));
    } else {
      para.push(line.replace(/^\s*>\s?/, ""));
    }
  }
  flush();

  const chunks: string[] = [];
  const chunkUnit: number[] = [];
  const firstChunk: number[] = [];
  const offsets: number[] = [];
  let chars = 0;
  units.forEach((u, idx) => {
    firstChunk.push(chunks.length);
    offsets.push(chars);
    chars += u.speech.length + 1;
    for (const c of chunkSpeech(u.speech)) {
      chunks.push(c);
      chunkUnit.push(idx);
    }
  });
  return { blocks, units, chunks, chunkUnit, firstChunk, offsets, totalChars: chars };
}

/** Rough speaking pace for time estimates in phone-voice mode. */
export const CHARS_PER_SECOND = 15;

/** The unit being spoken at a fraction (0..1) of the way through, for PC audio. */
export function unitAt(r: Reading, fraction: number): number {
  const target = Math.max(0, Math.min(1, fraction)) * r.totalChars;
  let u = 0;
  while (u + 1 < r.offsets.length && r.offsets[u + 1]! <= target) u++;
  return u;
}
