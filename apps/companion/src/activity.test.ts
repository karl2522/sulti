import { describe, expect, it } from "vitest";
import { toActivity, upsertActivity, MAX_ACTIVITY } from "./activity.js";

const cmd = (actions: unknown[], status = "inProgress", command = "npm test") => ({ type: "commandExecution", id: "c1", command, status, commandActions: actions });

describe("activity lines", () => {
  it("names reads, searches and listings by what they touch", () => {
    expect(toActivity(cmd([{ type: "read", name: "session.ts", path: "D:\\work\\sole-harbor\\auth\\session.ts" }]), 1)).toMatchObject({ kind: "read", text: "auth/session.ts", status: "running" });
    expect(toActivity(cmd([{ type: "search", query: "getTotal", path: null }]), 1)).toMatchObject({ kind: "search", text: "getTotal" });
    expect(toActivity(cmd([{ type: "listFiles", path: null }]), 1)).toMatchObject({ kind: "list", text: "files" });
  });

  it("falls back to the command for mixed or unknown actions, with its outcome", () => {
    expect(toActivity(cmd([{ type: "unknown", command: "npm test" }], "completed"), 1)).toMatchObject({ kind: "command", text: "npm test", status: "done" });
    expect(toActivity(cmd([{ type: "read", path: "a.ts" }, { type: "unknown" }], "declined", "cat a.ts | wc"), 1)).toMatchObject({ kind: "command", status: "failed" });
  });

  it("summarizes file changes and ignores other items", () => {
    const edit = { type: "fileChange", id: "f1", status: "inProgress", changes: [{ path: "D:/w/auth/migrate.ts" }, { path: "D:/w/auth/b.ts" }] };
    expect(toActivity(edit, 1)).toMatchObject({ kind: "edit", text: "auth/migrate.ts and 1 more" });
    expect(toActivity({ type: "agentMessage", id: "m1", text: "hi" }, 1)).toBeNull();
    expect(toActivity({ type: "fileChange", id: "f2", changes: [] }, 1)).toBeNull();
  });

  it("updates in place and keeps only the newest lines", () => {
    let list = upsertActivity([], { id: "a", kind: "command", text: "x", status: "running", at: 1 });
    list = upsertActivity(list, { id: "a", kind: "command", text: "x", status: "done", at: 9 });
    expect(list).toEqual([{ id: "a", kind: "command", text: "x", status: "done", at: 1 }]);
    for (let i = 0; i < 10; i++) list = upsertActivity(list, { id: String(i), kind: "read", text: "f", status: "done", at: i });
    expect(list).toHaveLength(MAX_ACTIVITY);
    expect(list.at(-1)?.id).toBe("9");
  });
});
