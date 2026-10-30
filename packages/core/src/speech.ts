/**
 * Markdown -> speakable text, then sentence-aligned chunks for TTS.
 * Pure TS, shared by the companion (PC audio) and the phone (Web Speech).
 */

export interface SpeechOptions {
  /** Read code blocks line by line instead of announcing and skipping them. */
  readCodeBlocks?: boolean;
}

export const MAX_CHUNK = 250;

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()\]]+/gi;
// Paths with at least two separators, or a drive letter, or ./ ../ ~/ prefixes.
// Segments are capped at 100 chars so a long unbroken token stays linear instead of O(n²).
const PATH_RE = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|[\\/])?(?:[\w.@-]{1,100}[\\/]){2,}[\w.@-]{1,100}|[A-Za-z]:[\\/](?:[\w.@-]{1,100}[\\/])*[\w.@-]{1,100}/g;

/** Keep the last two segments of a path: "src/checkout/cart.ts" -> "checkout/cart.ts". */
export function shortenPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p && !/^[A-Za-z]:$/.test(p) && p !== "." && p !== ".." && p !== "~");
  return parts.slice(-2).join("/");
}

function inline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt ? `image: ${alt}` : "image"))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(URL_RE, "link")
    .replace(/`([^`]+)`/g, "$1")
    .replace(PATH_RE, (p) => shortenPath(p))
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function sentence(text: string): string {
  const t = text.trim().replace(/[,;:]$/, "");
  if (!t) return "";
  return /[.!?…]$/.test(t) ? t : t + ".";
}

/** Convert markdown to plain sentences separated by blank lines (paragraph = pause). */
export function toSpeechText(markdown: string, opts: SpeechOptions = {}): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(sentence(inline(para.join(" "))));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!);
      const n = body.length;
      if (opts.readCodeBlocks && n) blocks.push(body.map((l) => sentence(l.trim())).filter(Boolean).join(" "));
      else blocks.push(`Code block, ${n} ${n === 1 ? "line" : "lines"}, skipped.`);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      blocks.push(sentence(inline(heading[1]!)));
      continue;
    }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flush();
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flush();
      if (/^\s*\|?\s*:?-{2,}/.test(line)) continue; // separator row
      const cells = line.split("|").map((c) => inline(c)).filter(Boolean);
      if (cells.length) blocks.push(sentence(cells.join(", ")));
      continue;
    }
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (item) {
      flush();
      blocks.push(sentence(inline(item[1]!)));
      continue;
    }
    para.push(line.replace(/^\s*>\s?/, ""));
  }
  flush();
  return blocks.filter(Boolean).join("\n\n");
}

/** Split speech text into chunks of at most maxLen chars, aligned to sentences. */
export function chunkSpeech(text: string, maxLen = MAX_CHUNK): string[] {
  const chunks: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const sentences = para.replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
    let cur = "";
    for (const s of sentences) {
      for (const piece of splitLong(s, maxLen)) {
        if (!cur) cur = piece;
        else if (cur.length + 1 + piece.length <= maxLen) cur += " " + piece;
        else {
          chunks.push(cur);
          cur = piece;
        }
      }
    }
    if (cur) chunks.push(cur);
  }
  return chunks;
}

function splitLong(s: string, maxLen: number): string[] {
  if (s.length <= maxLen) return [s];
  const out: string[] = [];
  let rest = s;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen + 1);
    let cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
    if (cut < maxLen / 3) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = maxLen;
    else cut += 1; // keep the comma with the left part
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
