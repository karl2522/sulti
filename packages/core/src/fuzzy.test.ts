import { describe, expect, it } from "vitest";
import { ACCEPT_THRESHOLD, CONFIRM_THRESHOLD, bestMatch, jaroWinkler, phoneticKey, similarity } from "./fuzzy.js";
import { normalizeSpoken, numberWordsToDigits } from "./normalize.js";

describe("normalization", () => {
  it("lowercases, strips punctuation, splits hyphens, converts numbers", () => {
    expect(normalizeSpoken("Execute-Plans!")).toBe("execute plans");
    expect(normalizeSpoken("What's   the  goal?")).toBe("whats the goal");
    expect(normalizeSpoken("version twenty one")).toBe("version 21");
    expect(numberWordsToDigits("three tests")).toBe("3 tests");
  });
});

describe("jaro-winkler", () => {
  it("matches the textbook values", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("dixon", "dicksonx")).toBeCloseTo(0.813, 3);
    expect(jaroWinkler("abc", "abc")).toBe(1);
    expect(jaroWinkler("", "abc")).toBe(0);
  });
});

describe("phonetic key", () => {
  it("merges sound-alike spellings", () => {
    expect(phoneticKey("soul harbor")).toBe(phoneticKey("sole harbor"));
    expect(phoneticKey("led tracker")).toBe(phoneticKey("lead tracker"));
    expect(phoneticKey("execute planes")).toBe(phoneticKey("execute plans"));
  });
});

describe("fuzzy matcher", () => {
  const sessions = [
    { id: "sole-harbor", name: "Sole Harbor", aliases: ["soul harbor"] },
    { id: "lead-tracker", name: "Lead Tracker", aliases: ["led tracker"] },
    { id: "kernel-labs", name: "Kernel Labs", aliases: ["colonel labs"] },
  ];
  const skills = ["execute-plans", "systematic-debugging", "writing-tests"].map((n) => ({ id: n, name: n }));

  it.each([
    ["soul harbor", "sole-harbor"],
    ["sole harbour", "sole-harbor"],
    ["led tracker", "lead-tracker"],
    ["colonel labs", "kernel-labs"],
    ["kernel lab", "kernel-labs"],
  ])("%s -> %s above the accept threshold", (spoken, id) => {
    const m = bestMatch(spoken, sessions);
    expect(m?.id).toBe(id);
    expect(m!.score).toBeGreaterThanOrEqual(ACCEPT_THRESHOLD);
  });

  it.each([
    ["execute planes", "execute-plans"],
    ["systematic de bugging", "systematic-debugging"],
    ["writing test", "writing-tests"],
  ])("skill %s -> %s", (spoken, id) => {
    const m = bestMatch(spoken, skills);
    expect(m?.id).toBe(id);
    expect(m!.score).toBeGreaterThanOrEqual(ACCEPT_THRESHOLD);
  });

  it("scores unrelated words below the confirm threshold", () => {
    for (const w of ["bananas", "weather", "payments module"]) {
      expect(bestMatch(w, sessions)!.score).toBeLessThan(CONFIRM_THRESHOLD);
    }
  });

  it("is symmetric enough to rank the right candidate first", () => {
    expect(similarity("lead tracker", "Lead Tracker")).toBe(1);
    expect(similarity("tracker lead", "Lead Tracker")).toBeLessThan(1);
  });
});
