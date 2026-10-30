import { describe, expect, it } from "vitest";
import { MAX_CHUNK, chunkSpeech, shortenPath, toSpeechText } from "./speech.js";

describe("speech-text normalizer", () => {
  it("skips code blocks by default and can read them", () => {
    const md = "Before.\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n\nAfter.";
    expect(toSpeechText(md)).toBe("Before.\n\nCode block, 2 lines, skipped.\n\nAfter.");
    // Each code line becomes its own sentence so TTS pauses between lines.
    expect(toSpeechText(md, { readCodeBlocks: true })).toBe("Before.\n\nconst a = 1. const b = 2.\n\nAfter.");
    expect(toSpeechText("```\nx\n```")).toBe("Code block, 1 line, skipped.");
  });

  it("reads inline code plainly and shortens paths", () => {
    expect(toSpeechText("Run `npm test` in `src/checkout/cart.ts`")).toBe("Run npm test in checkout/cart.ts.");
    expect(shortenPath("D:\\work\\sole-harbor\\src\\index.ts")).toBe("src/index.ts");
    expect(toSpeechText("Edited apps/companion/src/server.ts and README.md")).toBe("Edited src/server.ts and README.md.");
  });

  it("replaces URLs with 'link' and keeps link text", () => {
    expect(toSpeechText("See https://example.com/docs?x=1 for details")).toBe("See link for details.");
    expect(toSpeechText("Read [the guide](https://example.com/guide).")).toBe("Read the guide.");
  });

  it("turns list items into sentences and headings into their own paragraph", () => {
    const md = "## What I checked\n\n- Ran the tests\n- All 12 passed\n1. First step\n2) Second step";
    expect(toSpeechText(md)).toBe("What I checked.\n\nRan the tests.\n\nAll 12 passed.\n\nFirst step.\n\nSecond step.");
  });

  it("strips emphasis, quotes, tables and rules", () => {
    const md = "**Bold** and _italic_ text\n\n> quoted line\n\n---\n\n| File | Status |\n|---|---|\n| a.ts | ok |";
    expect(toSpeechText(md)).toBe("Bold and italic text.\n\nquoted line.\n\nFile, Status.\n\na.ts, ok.");
  });

  it("handles the normal fixture answer", () => {
    const md = "The checkout tests pass.\n\n## What I checked\n\n- Ran `npm test` in `src/checkout/cart.ts` and the payment module.\n- All 12 tests passed.\n\n```ts\nexpect(total).toBe(42);\n```\n\nSee https://example.com/docs for details.";
    expect(toSpeechText(md)).toBe(
      "The checkout tests pass.\n\nWhat I checked.\n\nRan npm test in checkout/cart.ts and the payment module.\n\nAll 12 tests passed.\n\nCode block, 1 line, skipped.\n\nSee link for details.",
    );
  });
});

describe("chunker", () => {
  it("keeps chunks under the limit and aligned to sentences", () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i + 1} of the answer.`);
    const chunks = chunkSpeech(sentences.join(" "));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(MAX_CHUNK);
      expect(c).toMatch(/\.$/);
    }
    expect(chunks.join(" ")).toBe(sentences.join(" "));
  });

  it("never merges across paragraphs (pauses)", () => {
    expect(chunkSpeech("Heading.\n\nBody one. Body two.")).toEqual(["Heading.", "Body one. Body two."]);
  });

  it("splits a very long sentence at commas or spaces", () => {
    const long = Array.from({ length: 80 }, (_, i) => `item${i}`).join(", ") + ".";
    const chunks = chunkSpeech(long);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_CHUNK);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("stays linear on a long unbroken token (answers can be 1 MB)", () => {
    const t = performance.now();
    toSpeechText("token " + "x".repeat(200_000) + " end");
    expect(performance.now() - t).toBeLessThan(500); // was minutes before the segment cap
  });
});
