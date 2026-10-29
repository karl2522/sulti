import { describe, expect, it } from "vitest";
import { buildReading, plain, unitAt } from "./reading.js";

const ANSWER = [
  "I found the checkout bug. The cart total is cached when the page loads.",
  "",
  "```ts",
  "export function getTotal(cart: Cart) {",
  "  return cart.cachedTotal ?? 0;",
  "}",
  "```",
  "",
  "## Next steps",
  "- Add up the **line items** instead.",
  "- Add a test for [late discounts](https://example.com/x).",
].join("\n");

describe("reading model", () => {
  it("splits prose into sentences and keeps code as one block", () => {
    const r = buildReading(ANSWER);
    expect(r.blocks.map((b) => (b.kind === "code" ? "code" : b.tag))).toEqual(["p", "code", "h", "li", "li"]);
    expect(r.units.map((u) => u.text).filter(Boolean)).toEqual([
      "I found the checkout bug.",
      "The cart total is cached when the page loads.",
      "Next steps",
      "Add up the line items instead.",
      "Add a test for late discounts.",
    ]);
  });

  it("announces skipped code, or reads it when asked", () => {
    const code = (rc: boolean) => {
      const r = buildReading(ANSWER, rc);
      const b = r.blocks.find((x) => x.kind === "code");
      return b && b.kind === "code" ? r.units[b.unit]!.speech : "";
    };
    expect(code(false)).toBe("Code block, 3 lines, skipped.");
    expect(code(true)).toContain("return cart.cachedTotal");
  });

  it("maps every queue chunk back to its sentence", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Word${i}`).join(" ") + " " + "x".repeat(300) + ".";
    const r = buildReading(`Short one. ${long}`);
    expect(r.chunks.length).toBeGreaterThan(r.units.length);
    expect(r.chunkUnit[0]).toBe(0);
    expect(r.chunkUnit.at(-1)).toBe(1);
    expect(r.firstChunk).toEqual([0, 1]);
  });

  it("finds the sentence at a point in the audio", () => {
    const r = buildReading("One. Two. Three.");
    expect(unitAt(r, 0)).toBe(0);
    expect(unitAt(r, 0.5)).toBe(1);
    expect(unitAt(r, 1)).toBe(2);
  });

  it("strips links and emphasis but keeps inline code", () => {
    expect(plain("Use **bold**, _soft_ and [a link](http://x) with `npm test`.")).toBe("Use bold, soft and a link with `npm test`.");
  });
});
