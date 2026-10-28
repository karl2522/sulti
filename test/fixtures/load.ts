import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "app-server");
export type FixtureName = "normal" | "interrupted" | "failed-usage-limit" | "approval" | "skill" | "no-phase";

export const DEFAULT_VARS: Record<string, string> = {
  threadId: "thread-0001",
  turnId: "turn-0001",
  prompt: "Run the tests.",
  cwd: "D:/work/sole-harbor",
  skillName: "systematic-debugging",
  skillPath: "D:/skills/systematic-debugging/SKILL.md",
  requestId: "0",
  decision: "accept",
};

/** Replace {{name}} placeholders inside JSON string values (JSON-escaped). */
export function fillPlaceholders(line: string, vars: Record<string, string>): string {
  return line.replace(/\{\{(\w+)\}\}/g, (m, key: string) => (key in vars ? JSON.stringify(vars[key]).slice(1, -1) : m));
}

/** Raw fixture lines with placeholders filled, directives included. */
export function fixtureLines(name: FixtureName, vars: Record<string, string> = {}): Record<string, unknown>[] {
  const all = { ...DEFAULT_VARS, ...vars };
  return readFileSync(join(FIXTURE_DIR, `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(fillPlaceholders(l, all)) as Record<string, unknown>);
}

/** Only real server messages: directives dropped, approval branch resolved with vars.decision. */
export function fixtureMessages(name: FixtureName, vars: Record<string, string> = {}): { method?: string; params?: unknown }[] {
  const decision = vars.decision ?? DEFAULT_VARS.decision!;
  const out: { method?: string; params?: unknown }[] = [];
  for (const line of fixtureLines(name, vars)) {
    if ("$ifDecision" in line) {
      const branch = (line.$ifDecision as string[]).includes(decision) ? line.then : line.else;
      out.push(...(branch as { method?: string; params?: unknown }[]));
    } else if (!Object.keys(line).some((k) => k.startsWith("$"))) {
      out.push(line as { method?: string; params?: unknown });
    }
  }
  return out;
}
