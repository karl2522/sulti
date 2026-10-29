import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { route } from "@sulti/core";
import { describe, expect, it } from "vitest";
import { BENCH_CONTEXT, matches, parseCases, signature, wavSeconds } from "./bench.js";

const cases = parseCases(readFileSync(fileURLToPath(new URL("./utterances.tsv", import.meta.url)), "utf8"));

describe("stt bench", () => {
  it("covers the Section 9 corpus", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.map((c) => c.file)).size).toBe(cases.length);
  });

  // If the router changes, this keeps the expected answers honest: a perfect
  // transcript must score 100%, so any miss in a real run is the STT's fault.
  it.each(cases)("$file routes as expected from the clean text", (c) => {
    expect(matches(c.expected, signature(route(c.utterance, BENCH_CONTEXT).intent))).toBe(true);
  });

  it("requires needsConfirm only when the expectation says so", () => {
    expect(matches("prompt:kernel-labs", "prompt:kernel-labs!")).toBe(true);
    expect(matches("app:switchSession:?!", "app:switchSession:?")).toBe(false);
  });

  it("reads WAV duration from the header", () => {
    const b = Buffer.alloc(44 + 32000);
    b.write("RIFF", 0);
    b.write("WAVEfmt ", 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt32LE(32000, 28); // byte rate: 16 kHz mono 16-bit
    b.write("data", 36);
    b.writeUInt32LE(32000, 40);
    expect(wavSeconds(b)).toBe(1);
    expect(wavSeconds(Buffer.from("nope"))).toBe(0);
  });
});
