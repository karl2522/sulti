import { closeSync, openSync, readdirSync, readSync, statSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { OpenFileProbe } from "./openfiles.js";

/** Where Codex keeps one log per chat (JSON lines), appended live while it works. */
export function codexSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
}

/** A turn with no new log lines for this long counts as over: the terminal crashed or closed mid-turn. */
export const STALE_MS = 30 * 60_000;
const TICK_MS = 1500;
const WALK_MS = 30_000;
const CHUNK = 1 << 20;
const MAX_BACK = 16 * CHUNK;
const MAX_FIRST_LINE = 4 * CHUNK;
/** Only logs written in the last week are checked for being open, newest first. */
const OPEN_WINDOW_MS = 7 * 24 * 60 * 60_000;
const MAX_OPEN_CHECKS = 60;

// Matches whole log lines only: inside a JSON string these quotes would be escaped.
const MARK = /\{"timestamp":"([^"]+)"[^\n]*?"type":"event_msg","payload":\{"type":"(task_started|task_complete|turn_aborted)"/g;

interface Log {
  /** The chat (thread) id, from the file name. */
  id: string;
  /** Bytes read so far, up to the last complete line. */
  size: number;
  mtime: number;
  /** Folder; null for logs to ignore (subagents, codex exec), undefined until needed. */
  cwd?: string | null;
  /** Start of the turn in progress, or null. */
  startedAt: number | null;
  /** A Codex process has this log open: the chat is open in a terminal or the Codex app. */
  open?: boolean;
}

export interface TerminalState {
  /** Folder -> start of the turn running there. */
  turns: Map<string, number>;
  /** Folders with a chat open in Codex, or null when that can't be told (not Windows). */
  open: Set<string> | null;
}

const chatId = (path: string) => /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(basename(path))?.[1] ?? basename(path);

const read = (fd: number, start: number, end: number) => {
  const b = Buffer.alloc(Math.max(0, end - start));
  return b.subarray(0, readSync(fd, b, 0, b.length, start));
};

/** Start of the turn the text ends in; null if that turn ended; undefined if the text has no turn events. */
function lastTurn(text: string): number | null | undefined {
  let last: RegExpMatchArray | undefined;
  for (const m of text.matchAll(MARK)) last = m;
  if (!last) return undefined;
  return last[2] === "task_started" ? Date.parse(last[1]!) || Date.now() : null;
}

/** The folder from the first line (session_meta). undefined while that line is still being written. */
function folderOf(fd: number, size: number): string | null | undefined {
  for (let end = Math.min(size, CHUNK); ; end = Math.min(size, end * 2)) {
    const b = read(fd, 0, end);
    const nl = b.indexOf(10);
    if (nl >= 0) {
      try {
        const p = (JSON.parse(b.subarray(0, nl).toString("utf8")) as { payload?: { cwd?: unknown; source?: unknown } }).payload;
        // Subagents and codex exec runs aren't sessions you talk to.
        return typeof p?.cwd === "string" && typeof p.source === "string" && p.source !== "exec" ? p.cwd : null;
      } catch {
        return null;
      }
    }
    if (end >= size) return undefined;
    if (end >= MAX_FIRST_LINE) return null;
  }
}

/** Walk back from the end to the last turn event. Also returns where the last complete line ends. */
function scanBack(fd: number, size: number): { startedAt: number | null; size: number } {
  const start = Math.max(0, size - CHUNK);
  const tail = read(fd, start, size);
  const complete = start + tail.lastIndexOf(10) + 1;
  let t = lastTurn(tail.subarray(0, complete - start).toString("utf8"));
  // Earlier chunks overlap by 1 KB so a line split across chunks still matches.
  for (let end = start; t === undefined && end > 0 && size - end < MAX_BACK; end -= CHUNK) t = lastTurn(read(fd, Math.max(0, end - CHUNK), end + 1024).toString("utf8"));
  return { startedAt: t ?? null, size: complete };
}

/**
 * Turns running in Codex terminals, read from Codex's own session logs: a turn writes
 * task_started when it begins and task_complete or turn_aborted when it ends.
 * Read only; no hooks or setup. Reports folder -> start of its running turn.
 */
export class TerminalWatcher {
  private readonly logs = new Map<string, Log>();
  private readonly dirty = new Set<string>();
  private watcher: FSWatcher | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private last = "";
  private openKnown = false;
  private probing: Promise<void> | null = null;
  private probeAgain = false;

  constructor(
    private readonly root: string,
    private readonly onChange: (state: TerminalState) => void,
    private readonly log: (msg: string) => void = () => {},
    private readonly now: () => number = Date.now,
    private readonly probe: OpenFileProbe | null = null,
  ) {}

  start(): void {
    this.refresh();
    this.timers = [setInterval(() => this.flush(), TICK_MS), setInterval(() => this.refresh(), WALK_MS)];
    for (const t of this.timers) t.unref();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.watcher?.close();
    this.watcher = null;
    this.probe?.stop();
  }

  /** Re-read every log now (the phone just opened, or the periodic pass), then check which are open. */
  refresh(): void {
    this.dirty.clear();
    let names: string[] = [];
    try {
      names = readdirSync(this.root, { recursive: true }).map(String);
    } catch {
      // No Codex sessions folder yet.
    }
    const seen = new Set<string>();
    for (const n of names) {
      if (!n.endsWith(".jsonl")) continue;
      const p = join(this.root, n);
      seen.add(p);
      this.check(p);
    }
    for (const p of this.logs.keys()) if (!seen.has(p)) this.logs.delete(p);
    if (!this.watcher) this.watchRoot();
    this.emit();
    void this.checkOpen();
  }

  /** Folder -> start of the turn running there (the earliest, if several terminals share a folder). */
  turns(): Map<string, number> {
    const out = new Map<string, number>();
    const now = this.now();
    for (const l of this.logs.values()) {
      if (!l.cwd || l.startedAt === null || now - l.mtime > STALE_MS) continue;
      out.set(l.cwd, Math.min(out.get(l.cwd) ?? Infinity, l.startedAt));
    }
    return out;
  }

  /** Folders with a chat open in Codex; null until known. */
  openFolders(): Set<string> | null {
    if (!this.openKnown) return null;
    return new Set([...this.logs.values()].filter((l) => l.open && l.cwd).map((l) => l.cwd!));
  }

  /** Whether one chat is open in Codex and mid-turn, for the phone's chat list. */
  chat(id: string): { open?: boolean; working: boolean } {
    const now = this.now();
    for (const l of this.logs.values()) {
      if (l.id === id) return { ...(this.openKnown ? { open: !!l.open } : {}), working: l.startedAt !== null && now - l.mtime <= STALE_MS };
    }
    return { working: false };
  }

  /** Waits for the open check in progress, if any (tests and the first phone list). */
  settled(): Promise<void> {
    return this.probing ?? Promise.resolve();
  }

  private checkOpen(): Promise<void> {
    if (!this.probe) return Promise.resolve();
    if (this.probing) {
      this.probeAgain = true;
      return this.probing;
    }
    const run = async () => {
      do {
        this.probeAgain = false;
        const now = this.now();
        const recent = [...this.logs.entries()]
          .filter(([, l]) => now - l.mtime < OPEN_WINDOW_MS)
          .sort(([, a], [, b]) => b.mtime - a.mtime)
          .slice(0, MAX_OPEN_CHECKS);
        const open = await this.probe!.check(recent.map(([p]) => p));
        if (!open) continue; // can't tell right now; keep what we knew
        for (const l of this.logs.values()) l.open = false;
        for (const [p, l] of recent) {
          l.open = open.has(p);
          if (l.open && l.cwd === undefined) l.cwd = this.folder(p);
        }
        this.openKnown = true;
        this.emit();
      } while (this.probeAgain);
    };
    this.probing = run()
      .catch((err: Error) => this.log(`open-file check failed: ${err.message}`))
      .finally(() => (this.probing = null));
    return this.probing;
  }

  private folder(path: string): string | null {
    try {
      const fd = openSync(path, "r");
      try {
        return folderOf(fd, statSync(path).size) ?? null;
      } finally {
        closeSync(fd);
      }
    } catch {
      return null;
    }
  }

  private flush(): void {
    const paths = [...this.dirty];
    this.dirty.clear();
    for (const p of paths) this.check(p);
    this.emit();
  }

  private emit(): void {
    const state = { turns: this.turns(), open: this.openFolders() };
    const key = JSON.stringify([[...state.turns].sort(), state.open && [...state.open].sort()]);
    if (key === this.last) return;
    this.last = key;
    try {
      this.onChange(state);
    } catch (err) {
      this.log(`terminal status update failed: ${(err as Error).message}`);
    }
  }

  private watchRoot(): void {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_e, name) => {
        if (name && String(name).endsWith(".jsonl")) this.dirty.add(join(this.root, String(name)));
      });
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = null; // the next refresh tries again
      });
    } catch {
      this.watcher = null;
    }
  }

  private check(path: string): void {
    try {
      const st = statSync(path);
      const known = this.logs.get(path);
      if (known && st.size === known.size) return void (known.mtime = st.mtimeMs);
      // An old, quiet log can't be mid-turn: note its size and read it only if it grows (codex resume).
      if (!known && this.now() - st.mtimeMs > STALE_MS) return void this.logs.set(path, { id: chatId(path), size: st.size, mtime: st.mtimeMs, startedAt: null });
      const fd = openSync(path, "r");
      try {
        const cwd = known && st.size >= known.size && known.cwd !== undefined ? known.cwd : folderOf(fd, st.size);
        if (cwd === undefined) return; // first line still being written; look again next time
        if (!known || st.size < known.size || st.size - known.size > MAX_BACK) {
          const back = cwd ? scanBack(fd, st.size) : { startedAt: null, size: st.size };
          return void this.logs.set(path, { id: chatId(path), cwd, mtime: st.mtimeMs, open: known?.open, ...back });
        }
        known.cwd = cwd;
        known.mtime = st.mtimeMs;
        const added = read(fd, known.size, st.size);
        const end = added.lastIndexOf(10) + 1; // complete lines only
        if (!end) return;
        const t = cwd ? lastTurn(added.subarray(0, end).toString("utf8")) : undefined;
        if (t !== undefined) known.startedAt = t;
        known.size += end;
      } finally {
        closeSync(fd);
      }
    } catch {
      this.logs.delete(path); // gone or unreadable; the next pass picks it up again
    }
  }
}
