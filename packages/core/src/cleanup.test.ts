import { describe, expect, it } from "vitest";
import { cleanupPrompt } from "./cleanup.js";

describe("prompt cleanup", () => {
  it.each([
    ["run the tests", "Run the tests."],
    ["Run the tests.", "Run the tests."],
    ["um run the tests", "Run the tests."],
    ["uh, like, check the logs", "Check the logs."],
    ["investigate the checkout problem don't modify anything yet", "Investigate the checkout problem. Don't modify anything yet."],
    ["why is the build red", "Why is the build red?"],
    ["fix it then i will review", "Fix it then I will review."],
    ["first sentence. second one", "First sentence. Second one."],
    ["  ", ""],
  ])("%j -> %j", (input, output) => {
    expect(cleanupPrompt(input)).toBe(output);
  });

  it("keeps meaning: words that look like filler mid-sentence stay", () => {
    expect(cleanupPrompt("make it look like the old page")).toBe("Make it look like the old page.");
  });

  it("does not break short clauses", () => {
    expect(cleanupPrompt("please don't push")).toBe("Please don't push.");
  });
});
