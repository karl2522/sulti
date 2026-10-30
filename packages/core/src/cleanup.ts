/** Light cleanup of dictated prompt text. Fixes form, never meaning. */

const FILLER = /^(?:(?:um+|uh+|uhm|erm|er|hmm+|like)[,.]?\s+)+/i;
const QUESTION_START = /^(?:what|why|how|when|where|who|which|can|could|would|should|will|is|are|was|were|does|do|did|have|has)\b/i;
/** Words that start a new instruction when dictated without punctuation. */
const BREAK_BEFORE = /\s+(?=(?:don['’]?t|do not|please|make sure|after that|also)\b)/gi;

function capitalize(s: string): string {
  return s.replace(/^(\s*)(\p{Ll})/u, (_m, sp: string, ch: string) => sp + ch.toUpperCase());
}

function endPunctuate(sentence: string): string {
  const s = sentence.replace(/[,;:\s]+$/, "");
  if (!s || /[.!?…]$/.test(s)) return s;
  return s + (QUESTION_START.test(s) ? "?" : ".");
}

export function cleanupPrompt(raw: string): string {
  // Line breaks mean typed or pasted text (a list, code, a stack trace): keep it exactly.
  if (raw.includes("\n")) return raw.trim();
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return text;
  // Split into sentences on existing punctuation, then on instruction breaks.
  const sentences: string[] = [];
  for (const part of text.split(/(?<=[.!?])\s+/)) {
    const pieces = part.split(BREAK_BEFORE);
    // Only break when the first piece is a real clause (3+ words).
    let acc = pieces[0]!;
    for (const piece of pieces.slice(1)) {
      if (acc.split(" ").length >= 3 && !/[.!?,;:]$/.test(acc)) {
        sentences.push(acc);
        acc = piece;
      } else acc += " " + piece;
    }
    sentences.push(acc);
  }
  text = sentences
    .map((s) => s.replace(FILLER, "").trim())
    .filter(Boolean)
    .map((s) => endPunctuate(capitalize(s)).replace(/\bi\b/g, "I"))
    .join(" ");
  return text;
}
