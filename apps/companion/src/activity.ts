import { shortenPath, type ActivityItem } from "@sulti/core";

/** How many "right now" lines each session keeps. */
export const MAX_ACTIVITY = 6;

const STATUS: Record<string, ActivityItem["status"]> = {
  inProgress: "running",
  completed: "done",
  failed: "failed",
  declined: "failed",
};

const clip = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * Turn an app-server command or file-change item into one readable line:
 * "Read auth/session.ts", "Ran npm test", "Editing auth/migrate.ts".
 * Everything else (messages, reasoning, tool calls) returns null.
 */
export function toActivity(raw: unknown, at: number): ActivityItem | null {
  const item = (raw ?? {}) as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id) return null;
  const status = STATUS[String(item.status)] ?? "running";
  if (item.type === "fileChange") {
    const paths = Array.isArray(item.changes) ? item.changes.map((c) => String((c as { path?: unknown }).path ?? "")).filter(Boolean) : [];
    if (!paths.length) return null;
    const text = shortenPath(paths[0]!) + (paths.length > 1 ? ` and ${paths.length - 1} more` : "");
    return { id: item.id, kind: "edit", text: clip(text), status, at };
  }
  if (item.type !== "commandExecution") return null;
  const actions = Array.isArray(item.commandActions) ? (item.commandActions as Record<string, unknown>[]) : [];
  const types = new Set(actions.map((a) => a.type));
  if (actions.length && types.size === 1) {
    const a = actions[0]!;
    if (a.type === "read") {
      const names = actions.map((x) => shortenPath(String(x.path ?? x.name ?? ""))).filter(Boolean);
      if (names.length) return { id: item.id, kind: "read", text: clip(names.join(", ")), status, at };
    }
    if (a.type === "search" && typeof a.query === "string" && a.query) return { id: item.id, kind: "search", text: clip(a.query), status, at };
    if (a.type === "listFiles") return { id: item.id, kind: "list", text: clip(typeof a.path === "string" && a.path ? shortenPath(a.path) : "files"), status, at };
  }
  const command = typeof item.command === "string" ? item.command.trim() : "";
  return command ? { id: item.id, kind: "command", text: clip(command), status, at } : null;
}

/** Insert or update an item, keeping the newest MAX_ACTIVITY. */
export function upsertActivity(list: readonly ActivityItem[], next: ActivityItem): ActivityItem[] {
  const i = list.findIndex((x) => x.id === next.id);
  const out = i >= 0 ? list.map((x, j) => (j === i ? { ...next, at: x.at } : x)) : [...list, next];
  return out.slice(-MAX_ACTIVITY);
}
