import { join } from "node:path";
import { z } from "zod";
import type { SessionInfo, SessionStatus } from "@sulti/core";
import { readJson } from "./store.js";
import { folderName, isSameOrInside, normalizeWinPath } from "./paths.js";

/** Values confirmed against the installed Codex in T1 (docs/PROTOCOL_NOTES.md). */
export const SandboxMode = z.enum(["read-only", "workspace-write", "danger-full-access"]);
export const ApprovalPolicy = z.enum(["untrusted", "on-request", "never"]);

export const SessionConfig = z.object({
  name: z.string().min(1).max(80),
  cwd: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  sandbox: SandboxMode.default("workspace-write"),
  approvalPolicy: ApprovalPolicy.default("on-request"),
});
export type SessionConfig = z.infer<typeof SessionConfig>;

export interface Session extends SessionConfig {
  id: string;
  unlisted: boolean;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "session"
  );
}

export function parseSessions(raw: unknown): Session[] {
  const list = Array.isArray(raw) ? raw : ((raw as { sessions?: unknown })?.sessions ?? []);
  const parsed = z.array(SessionConfig).parse(list);
  const seen = new Set<string>();
  return parsed.map((s) => {
    let id = slugify(s.name);
    while (seen.has(id)) id += "-2";
    seen.add(id);
    return { ...s, id, unlisted: false };
  });
}

export function loadSessions(dataDir: string): Session[] {
  return parseSessions(readJson<unknown>(join(dataDir, "sessions.json"), { sessions: [] }));
}

/** Session registry: configured sessions plus "unlisted" ones discovered from Stop hooks. */
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();
  private readonly status = new Map<string, SessionStatus>();

  constructor(configured: Session[]) {
    for (const s of configured) this.sessions.set(s.id, s);
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** Map a cwd to a session: exact match first, then the deepest configured parent folder. */
  findByCwd(cwd: string): Session | undefined {
    const target = normalizeWinPath(cwd);
    let best: Session | undefined;
    for (const s of this.sessions.values()) {
      if (normalizeWinPath(s.cwd) === target) return s;
      if (!s.unlisted && isSameOrInside(cwd, s.cwd) && (!best || s.cwd.length > best.cwd.length)) best = s;
    }
    return best;
  }

  /** Find or create the session for a hook's cwd. */
  forHookCwd(cwd: string): Session {
    const found = this.findByCwd(cwd);
    if (found) return found;
    const name = folderName(cwd);
    let id = "unlisted-" + slugify(name);
    while (this.sessions.has(id)) id += "-2";
    const s: Session = { id, name, cwd, aliases: [], sandbox: "read-only", approvalPolicy: "on-request", unlisted: true };
    this.sessions.set(id, s);
    return s;
  }

  getStatus(id: string): SessionStatus {
    return this.status.get(id) ?? "idle";
  }

  setStatus(id: string, st: SessionStatus): boolean {
    if (this.getStatus(id) === st) return false;
    this.status.set(id, st);
    return true;
  }

  info(id: string, threadId: string | null): SessionInfo | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    return { id: s.id, name: s.name, aliases: s.aliases, status: this.getStatus(id), unlisted: s.unlisted, threadId };
  }
}
