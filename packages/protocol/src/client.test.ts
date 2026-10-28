import { describe, expect, it } from "vitest";
import { AppServerClient, RpcError } from "./client.js";
import { LineSplitter, type Transport } from "./transport.js";

/** In-memory transport: lines the client sends go to "sent"; push() simulates the server. */
function memTransport() {
  const sent: Record<string, unknown>[] = [];
  let lineCb: (l: string) => void = () => {};
  let closeCb: (r: string) => void = () => {};
  const t: Transport = {
    send: (l) => void sent.push(JSON.parse(l)),
    onLine: (cb) => void (lineCb = cb),
    onClose: (cb) => void (closeCb = cb),
    close: () => closeCb("closed"),
  };
  return { t, sent, push: (m: object) => lineCb(JSON.stringify(m)), drop: (r: string) => closeCb(r) };
}

describe("LineSplitter", () => {
  it("handles partial chunks and CRLF", () => {
    const lines: string[] = [];
    const s = new LineSplitter((l) => lines.push(l));
    s.push('{"a":1}\r\n{"b"');
    s.push(':2}\n\n{"c":3}');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    s.push("\n");
    expect(lines).toHaveLength(3);
  });
});

describe("AppServerClient", () => {
  it("does the initialize handshake without a jsonrpc field", async () => {
    const m = memTransport();
    const c = new AppServerClient(m.t);
    const p = c.initialize({ name: "sulti", title: "Sulti", version: "0.1.0" });
    expect(m.sent[0]).toMatchObject({ method: "initialize", id: 1, params: { clientInfo: { name: "sulti" } } });
    expect(m.sent[0]).not.toHaveProperty("jsonrpc");
    m.push({ id: 1, result: { userAgent: "x" } });
    await p;
    expect(m.sent[1]).toEqual({ method: "initialized", params: {} });
  });

  it("correlates out-of-order responses and maps errors", async () => {
    const m = memTransport();
    const c = new AppServerClient(m.t);
    const a = c.request("thread/goal/get", { threadId: "a" });
    const b = c.request("thread/goal/get", { threadId: "b" });
    m.push({ id: 2, result: { goal: null } });
    m.push({ id: 1, error: { code: -32600, message: "bad" } });
    await expect(b).resolves.toEqual({ goal: null });
    await expect(a).rejects.toMatchObject({ code: -32600, message: "bad" });
  });

  it("refuses unsandboxed and unknown methods before they reach the wire", async () => {
    const m = memTransport();
    const c = new AppServerClient(m.t);
    for (const method of ["thread/shellCommand", "command/exec", "process/spawn", "fs/remove"]) {
      await expect(c.request(method as "model/list", {})).rejects.toBeInstanceOf(RpcError);
    }
    expect(m.sent).toEqual([]);
  });

  it("times out", async () => {
    const m = memTransport();
    const c = new AppServerClient(m.t, { timeoutMs: 20 });
    await expect(c.request("model/list", {})).rejects.toMatchObject({ code: -32001 });
  });

  it("dispatches notifications and answers server requests", async () => {
    const m = memTransport();
    const c = new AppServerClient(m.t);
    const seen: unknown[] = [];
    c.on("turn/started", (p) => seen.push(p.turn.id));
    c.onServerRequest(async (method) => (method === "item/commandExecution/requestApproval" ? { decision: "decline" } : null));
    m.push({ method: "turn/started", params: { threadId: "t", turn: { id: "turn-1" } } });
    m.push({ id: 99, method: "item/commandExecution/requestApproval", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(["turn-1"]);
    expect(m.sent).toContainEqual({ id: 99, result: { decision: "decline" } });
  });

  it("rejects pending requests when the transport closes", async () => {
    const m = memTransport();
    const c = new AppServerClient(m.t);
    const p = c.request("thread/list", {});
    m.drop("process exited (1)");
    await expect(p).rejects.toThrow(/process exited/);
    expect(c.closed).toBe(true);
  });
});
