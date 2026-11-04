import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OpenFileProbe } from "./openfiles.js";

describe.skipIf(!OpenFileProbe.supported())("open-file check (Windows Restart Manager)", () => {
  it("sees a file another process holds open, and ignores this process", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sulti-open-"));
    const held = join(dir, "held.jsonl");
    const free = join(dir, "free.jsonl");
    writeFileSync(held, "x");
    writeFileSync(free, "y");
    const probe = new OpenFileProbe();
    const holder = spawn(process.execPath, ["-e", `require("fs").openSync(${JSON.stringify(held)}, "r"); console.log("held"); setInterval(() => {}, 1000)`]);
    try {
      await new Promise((r) => holder.stdout.once("data", r));
      expect(await probe.check([held, free])).toEqual(new Set([held]));
      holder.kill();
      await new Promise((r) => holder.once("exit", r));
      expect(await probe.check([held, free])).toEqual(new Set());
    } finally {
      holder.kill();
      probe.stop();
    }
  }, 30_000);
});
