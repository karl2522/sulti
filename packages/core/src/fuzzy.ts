/**
 * Fuzzy matching of spoken names against session names, aliases and skill
 * names: Jaro-Winkler on the normalized text (with and without spaces),
 * combined with a small Metaphone-style phonetic key.
 */
import { normalizeSpoken } from "./normalize.js";

export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aM = new Array<boolean>(a.length).fill(false);
  const bM = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = bM[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  return (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
}

export function jaroWinkler(a: string, b: string, scale = 0.1): number {
  const j = jaro(a, b);
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return j + prefix * scale * (1 - j);
}

/** Simplified Metaphone key for one word (consonant skeleton, sound-alike letters merged). */
export function phoneticWord(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return word;
  w = w
    .replace(/^kn|^gn|^pn|^wr/, (m) => m[1]!)
    .replace(/^x/, "s")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/sch/g, "sk")
    .replace(/sh/g, "x")
    .replace(/th/g, "0")
    .replace(/dg(?=[eiy])/g, "j")
    .replace(/gh(?![aeiou])/g, "")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/g(?=[eiy])/g, "j")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/d/g, "t")
    .replace(/v/g, "f")
    .replace(/wh/g, "w");
  const first = /[aeiou]/.test(w[0]!) ? "a" : w[0]!;
  const rest = w.slice(1).replace(/[aeiouyhw]/g, "");
  return (first + rest).replace(/(.)\1+/g, "$1");
}

export function phoneticKey(text: string): string {
  return normalizeSpoken(text).split(" ").filter(Boolean).map(phoneticWord).join(" ");
}

/** Similarity in [0, 1] between a spoken phrase and a candidate name. */
export function similarity(spoken: string, candidate: string): number {
  const s = normalizeSpoken(spoken);
  const c = normalizeSpoken(candidate);
  if (!s || !c) return 0;
  if (s === c) return 1;
  const flatS = s.replace(/ /g, "");
  const flatC = c.replace(/ /g, "");
  if (flatS === flatC) return 0.99;
  const text = Math.max(jaroWinkler(s, c), jaroWinkler(flatS, flatC));
  const ps = phoneticKey(s);
  const pc = phoneticKey(c);
  const phon = ps === pc || ps.replace(/ /g, "") === pc.replace(/ /g, "") ? 0.95 : jaroWinkler(ps, pc) * 0.9;
  return Math.max(text, phon);
}

export interface Candidate {
  id: string;
  name: string;
  aliases?: readonly string[];
}

export interface Match {
  id: string;
  name: string;
  score: number;
}

/** At or above: accept without asking. */
export const ACCEPT_THRESHOLD = 0.9;
/** At or above (but below ACCEPT): use, but ask for confirmation. */
export const CONFIRM_THRESHOLD = 0.78;

/** Best candidate for a spoken phrase, scored over its name and aliases. */
export function bestMatch(spoken: string, candidates: readonly Candidate[]): Match | null {
  let best: Match | null = null;
  for (const c of candidates) {
    for (const form of [c.name, c.id, ...(c.aliases ?? [])]) {
      const score = similarity(spoken, form);
      if (!best || score > best.score) best = { id: c.id, name: c.name, score };
    }
  }
  return best;
}
