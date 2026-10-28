import { describe, expect, it } from "vitest";
import { isSameOrInside, normalizeWinPath } from "./paths.js";
import { SessionRegistry, parseSessions } from "./sessions.js";

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
});
