import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { isSameOrInside, normalizeWinPath } from "./paths.js";
import { SessionRegistry, loadSessions, parseSessions } from "./sessions.js";

describe("hand-edited data files", () => {
  it("accepts a UTF-8 byte-order mark (Windows PowerShell 5.1 writes one)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sulti-bom-"));
    writeFileSync(join(dir, "sessions.json"), "\uFEFF" + JSON.stringify({ sessions: [{ name: "Kernel Labs", cwd: "D:\\work\\kernel-labs" }] }));
    writeFileSync(join(dir, "config.json"), "\uFEFF" + JSON.stringify({ port: 7517 }));
    expect(loadSessions(dir).map((s) => s.name)).toEqual(["Kernel Labs"]);
    expect(loadConfig({}, { dataDir: dir }).port).toBe(7517);
  });

  it("reports a broken sessions.json instead of silently loading none", () => {
    const dir = mkdtempSync(join(tmpdir(), "sulti-badjson-"));
    writeFileSync(join(dir, "sessions.json"), "{ sessions: [ }");
    expect(() => loadSessions(dir)).toThrow(/sessions.json is not valid JSON/);
  });
});

describe("Windows path normalization", () => {
  it("is case-insensitive and slash-agnostic", () => {
    expect(normalizeWinPath("D:\\Work\\Sole-Harbor\\")).toBe("d:/work/sole-harbor");
    expect(normalizeWinPath("d:/work/sole-harbor")).toBe("d:/work/sole-harbor");
    expect(normalizeWinPath("\\\\?\\D:\\Work\\X")).toBe("d:/work/x");
    expect(normalizeWinPath("D:\\")).toBe("d:/");
  });
  it("detects subfolders without prefix false positives", () => {
    expect(isSameOrInside("D:\\work\\lead-tracker\\src", "d:/work/lead-tracker")).toBe(true);
    expect(isSameOrInside("D:\\work\\lead-tracker-old", "d:/work/lead-tracker")).toBe(false);
  });
});

describe("session registry", () => {
  const sessions = parseSessions({
    sessions: [
      { name: "Sole Harbor", cwd: "D:\\work\\sole-harbor", aliases: ["soul harbor"] },
      { name: "Lead Tracker", cwd: "D:\\work\\lead-tracker", aliases: ["led tracker"], sandbox: "read-only" },
    ],
  });

  it("applies defaults confirmed in T1", () => {
    expect(sessions[0]).toMatchObject({ id: "sole-harbor", sandbox: "workspace-write", approvalPolicy: "on-request", unlisted: false });
    expect(sessions[1]!.sandbox).toBe("read-only");
  });

  it("rejects unknown policy values", () => {
    expect(() => parseSessions([{ name: "x", cwd: "D:\\x", sandbox: "yolo" }])).toThrow();
  });

  it("maps hook cwds to sessions, including subfolders", () => {
    const reg = new SessionRegistry(sessions);
    expect(reg.forHookCwd("d:/WORK/sole-harbor").id).toBe("sole-harbor");
    expect(reg.forHookCwd("D:\\work\\lead-tracker\\packages\\api").id).toBe("lead-tracker");
  });

  it("creates one unlisted session per unknown folder", () => {
    const reg = new SessionRegistry(sessions);
    const a = reg.forHookCwd("E:\\scratch\\demo-app");
    expect(a).toMatchObject({ name: "demo-app", unlisted: true });
    expect(reg.forHookCwd("e:/scratch/demo-app/").id).toBe(a.id);
    expect(reg.list()).toHaveLength(3);
  });

  it("remembers unlisted folders across restarts with the same ids", () => {
    const file = join(mkdtempSync(join(tmpdir(), "sulti-unlisted-")), "unlisted.json");
    const first = new SessionRegistry(sessions, file);
    const ids = ["E:\\a\\demo", "E:\\b\\demo"].map((cwd) => first.forHookCwd(cwd).id);
    const again = new SessionRegistry(sessions, file);
    expect(again.list().filter((s) => s.unlisted).map((s) => s.id)).toEqual(ids);
    // A remembered folder that is now in sessions.json is not listed twice.
    const listed = parseSessions([{ name: "Demo", cwd: "E:\\a\\demo" }]);
    expect(new SessionRegistry(listed, file).list().map((s) => s.id)).toEqual(["demo", ids[1]]);
  });
});
