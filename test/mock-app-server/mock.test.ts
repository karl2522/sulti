import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { AppServerClient, stdioTransport } from "@sulti/protocol";
import { MOCK_SERVER } from "./paths.js";

const clients: AppServerClient[] = [];
afterEach(() => clients.splice(0).forEach((c) => c.close()));

function start(extra: string[] = []) {
  const child = spawn(process.execPath, [MOCK_SERVER, ...extra], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new AppServerClient(stdioTransport(child), { timeoutMs: 5000 });
  clients.push(client);
  return client;
}

describe("mock app-server", () => {
  it("rejects requests before initialize", async () => {
    const c = start();
    await expect(c.request("thread/list", {})).rejects.toThrow(/Not initialized/);
  });

  it("replays the normal fixture for a turn", async () => {
    const c = start();
    await c.initialize({ name: "test", title: "Test", version: "0" });
    const { thread } = await c.request("thread/start", { cwd: "/mock/sole-harbor" });
    const done = new Promise<string>((r) => c.on("turn/completed", (p) => r(p.turn.status)));
    const finals: string[] = [];
    c.on("item/completed", (p) => {
      if (p.item.type === "agentMessage" && p.item.phase === "final_answer") finals.push(p.item.text);
    });
    await c.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Run the tests.", text_elements: [] }] });
    expect(await done).toBe("completed");
    expect(finals[0]).toMatch(/^The checkout tests pass\./);
  });

  it("waits for turn/interrupt in the interrupted scenario", async () => {
    const c = start(["--scenario", "interrupted"]);
    await c.initialize({ name: "test", title: "Test", version: "0" });
    const { thread } = await c.request("thread/start", { cwd: "/mock/x" });
    const firstDelta = new Promise<void>((r) => c.on("item/agentMessage/delta", () => r()));
    const done = new Promise<string>((r) => c.on("turn/completed", (p) => r(p.turn.status)));
    const { turn } = await c.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Investigate.", text_elements: [] }] });
    await firstDelta;
    await c.request("turn/interrupt", { threadId: thread.id, turnId: turn.id });
    expect(await done).toBe("interrupted");
  });

  it("supports goals and rejects them on ephemeral threads", async () => {
    const c = start();
    await c.initialize({ name: "test", title: "Test", version: "0" });
    const { thread } = await c.request("thread/start", { cwd: "/mock/x" });
    await c.request("thread/goal/set", { threadId: thread.id, objective: "Ship it", origin: "user" });
    await c.request("thread/goal/set", { threadId: thread.id, status: "paused", origin: "user" });
    expect((await c.request("thread/goal/get", { threadId: thread.id })).goal).toMatchObject({ objective: "Ship it", status: "paused" });
    expect(await c.request("thread/goal/clear", { threadId: thread.id, origin: "user" })).toEqual({ cleared: true });
    const eph = await c.request("thread/start", { cwd: "/mock/x", ephemeral: true });
    await expect(c.request("thread/goal/get", { threadId: eph.thread.id })).resolves.toEqual({ goal: null });
    await expect(c.request("thread/goal/set", { threadId: eph.thread.id, objective: "x" })).rejects.toThrow(/ephemeral/);
  });
});
