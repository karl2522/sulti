/** Text normalization shared by the router and the fuzzy matcher. Pure TS. */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Lowercase, drop apostrophes, turn hyphens/underscores and other punctuation into spaces. */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** "twenty one" -> "21", "three" -> "3". Works on space-separated lowercase words. */
export function numberWordsToDigits(text: string): string {
  const words = text.split(" ").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w in TENS) {
      const next = words[i + 1];
      if (next && next in UNITS && UNITS[next]! < 10 && UNITS[next]! > 0) {
        out.push(String(TENS[w]! + UNITS[next]!));
        i++;
      } else out.push(String(TENS[w]));
    } else if (w in UNITS) out.push(String(UNITS[w]));
    else out.push(w);
  }
  return out.join(" ");
}

/** Full normalization for matching: lowercase, no punctuation, hyphen = space, number words = digits. */
export function normalizeSpoken(text: string): string {
  return numberWordsToDigits(normalizeWord(text).replace(/\s+/g, " "));
}

/** Split an utterance into original words plus a normalized form of each. */
export function tokenize(utterance: string): { orig: string[]; norm: string[] } {
  const orig = utterance.trim().split(/\s+/).filter(Boolean);
  return { orig, norm: orig.map((w) => normalizeSpoken(w)) };
}
