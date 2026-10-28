import { describe, expect, it } from "vitest";
import { scanText } from "./secret-scan.mjs";

// Fake secrets are assembled at runtime so this file itself stays clean.
const j = (...parts: string[]) => parts.join("");

describe("secret scan", () => {
  const cases: [string, string][] = [
    ["GitHub classic token", j("token = gh", "p_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4")],
    ["GitHub fine-grained token", j("github", "_pat_", "11ABCDEFG0123456789_abcdefghij")],
    ["OpenAI-style secret key", j("key: s", "k-", "proj-abcdefghijklmnopqrstuvwx")],
    ["PEM block", j("-----BEG", "IN OPENSSH PRIVATE KEY-----")],
    ["Codex auth.json content", j('{"refresh', '_token": "abcdefghijklmnop"}')],
    ["Tailscale hostname", j("https://my-pc.tail1234", ".ts", ".net/pair")],
    ["Windows user path", j("C:", "\\Us", "ers\\alice\\project")],
    ["macOS user path", j(" /Us", "ers/alice/project")],
  ];
  it.each(cases)("flags %s", (rule, line) => {
    expect(scanText("x.txt", line).map((f) => f.rule)).toContain(rule);
  });

  it("flags long high-entropy strings", () => {
    const findings = scanText("x.txt", j("const k = 'Zq8Lr2Vx", "9Tb4Nw7Ke1Jm6Hc3Pd5Ys0Gf'"));
    expect(findings.map((f) => f.rule)).toContain("high-entropy string");
  });

  it("ignores placeholders, UUIDs, prose and allow-marked lines", () => {
    const clean = [
      j("Proxy https://<pc>.<tailnet>.ts", ".net to the companion"),
      j("Never commit absolute user paths (C:\\Us", "ers\\… or /Us", "ers/…)"),
      "threadId: 019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b",
      "Tokens start with ghp_ or sk- and are long",
      j("x = 'Zq8Lr2Vx", "9Tb4Nw7Ke1Jm6Hc3Pd5Ys0Gf' // sulti", "-scan-allow"),
    ].join("\n");
    expect(scanText("x.md", clean)).toEqual([]);
  });
});
