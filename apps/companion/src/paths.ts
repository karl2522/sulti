/**
 * Windows-aware path normalization for matching a hook's cwd to a session.
 * Case-insensitive, slash-agnostic, ignores trailing separators and the
 * \\?\ long-path prefix. Pure string logic so it is testable on any OS.
 */
export function normalizeWinPath(p: string): string {
  let s = p.trim().replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
  s = s.replace(/\/{2,}/g, "/");
  if (s.length > 1) s = s.replace(/\/+$/, "");
  if (/^[a-zA-Z]:$/.test(s)) s += "/";
  return s.toLowerCase();
}

/** True when child is the same folder as parent or inside it. */
export function isSameOrInside(child: string, parent: string): boolean {
  const c = normalizeWinPath(child);
  const p = normalizeWinPath(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith("/") ? p : p + "/");
}

/** Last path segment, used to name unlisted sessions. */
export function folderName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
