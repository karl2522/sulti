import { APP_VERSION, shortenPath, type Answer, type ApprovalDecision, type Goal, type PhoneMessage, type SessionInfo, type SkillInfo } from "@sulti/core";
import { useState, type ReactNode } from "react";
import { ago, duration, STATUS_LABEL, tokens } from "./format.js";
import type { AppState, ApprovalCard, Toast } from "./state.js";
import { sessionName } from "./state.js";
import type { AutoRead, Device, PlaybackMode, Settings } from "./storage.js";
import type { NowPlaying, Player } from "./usePlayer.js";

type Send = (m: PhoneMessage) => boolean;

// ---------- small pieces ----------

export function StatusPill({ status }: { status: SessionInfo["status"] }) {
  return <span className={`pill status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast-${t.level}`} onClick={() => onDismiss(t.id)}>
          {t.message}
        </button>
      ))}
    </div>
  );
}

export function TopBar({ state, active }: { state: AppState; active: SessionInfo | null }) {
  const conn = state.conn === "open" ? "Connected" : state.conn === "connecting" ? "Connecting…" : "Offline, retrying…";
  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className={`dot dot-${state.conn}`} aria-label={conn} title={conn} />
        <strong>{active ? active.name : "Sulti"}</strong>
        {active && <StatusPill status={active.status} />}
      </div>
      {state.conn !== "open" && <span className="muted small">{conn}</span>}
    </header>
  );
}

export type View = "talk" | "sessions" | "settings";

export function BottomNav({ view, onView, approvals }: { view: View; onView: (v: View) => void; approvals: number }) {
  const item = (v: View, label: string, badge = 0) => (
    <button className={`nav-item${view === v ? " active" : ""}`} aria-current={view === v ? "page" : undefined} onClick={() => onView(v)}>
      {label}
      {badge > 0 && <span className="badge">{badge}</span>}
    </button>
  );
  return (
    <nav className="bottomnav">
      {item("talk", "Talk", approvals)}
      {item("sessions", "Sessions")}
      {item("settings", "Settings")}
    </nav>
  );
}

export function NowPlayingBar({ now, player }: { now: NowPlaying; player: Player }) {
  const playing = now.status === "playing";
  return (
    <div className="nowplaying">
      <div className="np-title">
        <span className="small muted">{now.status === "loading" ? "Preparing audio…" : now.status === "done" ? "Finished" : now.mode === "A" ? "Phone voice" : "PC audio"}</span>
        <strong>{now.title}</strong>
      </div>
      <div className="np-controls">
        {now.mode === "B" && (
          <button className="btn icon" aria-label="Back 15 seconds" onClick={() => player.seek(-15)}>
            −15
          </button>
        )}
        <button className="btn icon primary" aria-label={playing ? "Pause" : "Play"} disabled={now.status === "loading"} onClick={() => (playing ? player.pause() : player.resume())}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button className="btn icon" aria-label="Start over" onClick={() => player.restart()}>
          ↺
        </button>
        <button className="btn icon" aria-label="Stop" onClick={() => player.stop()}>
          ■
        </button>
      </div>
    </div>
  );
}

// ---------- Talk ----------

function ApprovalCardView({ a, name, send, onSent }: { a: ApprovalCard; name: string; send: Send; onSent: () => void }) {
  const respond = (decision: ApprovalDecision) => {
    if (send({ type: "approval.respond", requestId: a.requestId, decision })) onSent();
  };
  return (
    <article className="card approval">
      <div className="row">
        <span className="pill status-waitingApproval">{a.kind === "command" ? "Run a command" : "Change files"}</span>
        <span className="muted small">{name}</span>
      </div>
      <p>{a.summary}</p>
      {a.command && <pre className="code">{a.command}</pre>}
      {a.cwd && <p className="muted small">in {shortenPath(a.cwd)}</p>}
      <div className="actions">
        <button className="btn danger big" disabled={a.sent} onClick={() => respond("decline")}>
          Decline
        </button>
        <button className="btn primary big" disabled={a.sent} onClick={() => respond("accept")}>
          {a.sent ? "Sent…" : "Approve"}
        </button>
      </div>
    </article>
  );
}

function GoalPanel({ session, goal, send }: { session: SessionInfo; goal: Goal | null | undefined; send: Send }) {
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState("");
  const save = () => {
    const o = objective.trim();
    if (!o) return;
    if (send({ type: "goal.set", sessionId: session.id, objective: o })) {
      setEditing(false);
      setObjective("");
    }
  };
  return (
    <section className="card goal" aria-label="Goal">
      <div className="row">
        <strong>Goal</strong>
        {goal && <span className={`pill goal-${goal.status}`}>{goal.status}</span>}
        <button className="btn link" onClick={() => send({ type: "goal.get", sessionId: session.id })}>
          Refresh
        </button>
      </div>
      {goal ? (
        <>
          <p className="goal-objective">{goal.objective}</p>
          <p className="muted small">
            {tokens(goal.tokensUsed)} tokens{goal.tokenBudget ? ` of ${tokens(goal.tokenBudget)}` : ""} · {duration(goal.timeUsedSeconds)}
          </p>
        </>
      ) : (
        <p className="muted">{goal === undefined ? "Not loaded yet." : "No goal set."}</p>
      )}
      {editing ? (
        <div className="stack">
          <textarea rows={3} value={objective} maxLength={4000} placeholder="What should Codex work toward?" onChange={(e) => setObjective(e.target.value)} />
          <div className="actions">
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={!objective.trim()} onClick={save}>
              Set goal
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button className="btn" onClick={() => setEditing(true)}>
            {goal ? "New goal" : "Set goal"}
          </button>
          {goal?.status === "active" && (
            <button className="btn" onClick={() => send({ type: "goal.update", sessionId: session.id, status: "paused" })}>
              Pause
            </button>
          )}
          {goal && goal.status !== "active" && goal.status !== "complete" && (
            <button className="btn" onClick={() => send({ type: "goal.update", sessionId: session.id, status: "active" })}>
              Resume
            </button>
          )}
          {goal && (
            <button className="btn danger" onClick={() => confirm("Clear this goal?") && send({ type: "goal.clear", sessionId: session.id })}>
              Clear
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function AnswerCard(props: { answer: Answer; name: string; player: Player; send: Send; onCopyPhone: (a: Answer) => void }) {
  const { answer, name, player, send } = props;
  const [open, setOpen] = useState(false);
  const mine = player.now?.answerId === answer.id;
  const playing = mine && (player.now?.status === "playing" || player.now?.status === "loading");
  return (
    <article className={`card answer${mine ? " playing" : ""}`}>
      <div className="row">
        <strong>{name}</strong>
        <span className="muted small">
          {ago(answer.createdAt)}
          {answer.source === "hook" ? " · terminal" : ""}
        </span>
      </div>
      <div className={`answer-text${open ? " open" : ""}`} onClick={() => setOpen(!open)}>
        {answer.text}
      </div>
      <div className="actions">
        <button className="btn primary" onClick={() => (playing ? player.pause() : mine && player.now?.status === "paused" ? player.resume() : player.play(answer, name))}>
          {playing ? "Pause" : mine && player.now?.status === "paused" ? "Resume" : "Play"}
        </button>
        <button className="btn" onClick={() => props.onCopyPhone(answer)}>
          Copy on phone
        </button>
        <button className="btn" onClick={() => send({ type: "answer.copyToPc", answerId: answer.id })}>
          Copy to PC
        </button>
      </div>
    </article>
  );
}

function SkillsSheet({ skills, onPick, onClose }: { skills: SkillInfo[]; onPick: (s: SkillInfo) => void; onClose: () => void }) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  // Name matches first, then skills that only mention the word in their description.
  const shown = q
    ? [...skills.filter((s) => s.name.toLowerCase().includes(q)), ...skills.filter((s) => !s.name.toLowerCase().includes(q) && s.description.toLowerCase().includes(q))]
    : skills;
  return (
    <Sheet title="Skills" onClose={onClose}>
      {skills.length === 0 && <p className="muted">No skills found for this project.</p>}
      {skills.length > 6 && (
        <input type="search" value={filter} placeholder={`Filter ${skills.length} skills…`} aria-label="Filter skills" onChange={(e) => setFilter(e.target.value)} />
      )}
      {skills.length > 0 && shown.length === 0 && <p className="muted">No skill matches "{filter}".</p>}
      <ul className="list">
        {shown.map((s) => (
          <li key={s.path || s.name}>
            <button className="list-item" onClick={() => onPick(s)}>
              <strong>${s.name}</strong>
              {s.description && <span className="muted small clamp">{s.description}</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">Text in the composer is sent along with the skill.</p>
    </Sheet>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2>{title}</h2>
          <button className="btn link" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmSheet({ echo, onAnswer }: { echo: string; onAnswer: (accept: boolean) => void }) {
  return (
    <Sheet title="Did I get that right?" onClose={() => onAnswer(false)}>
      <p className="echo big-echo">{echo}</p>
      <div className="actions">
        <button className="btn big" onClick={() => onAnswer(false)}>
          Cancel
        </button>
        <button className="btn primary big" onClick={() => onAnswer(true)}>
          Yes, do it
        </button>
      </div>
    </Sheet>
  );
}

export interface TalkProps {
  state: AppState;
  active: SessionInfo | null;
  send: Send;
  player: Player;
  banner: Answer | null;
  onBanner: (play: boolean) => void;
  onApprovalSent: (requestId: string) => void;
  onCopyPhone: (a: Answer) => void;
}

export function TalkView(p: TalkProps) {
  const { state, active, send, player } = p;
  const [scope, setScope] = useState<"all" | "session">("all");
  const answers = scope === "session" && active ? state.answers.filter((a) => a.sessionId === active.id) : state.answers;
  return (
    <div className="view">
      {p.banner && (
        <div className="banner">
          <button className="btn primary big grow" onClick={() => p.onBanner(true)}>
            ▶ New answer from {sessionName(state, p.banner.sessionId)}
          </button>
          <button className="btn" aria-label="Dismiss" onClick={() => p.onBanner(false)}>
            ✕
          </button>
        </div>
      )}
      {state.approvals.length > 0 && (
        <section id="approvals" className="stack">
          <h2>Waiting for you</h2>
          {state.approvals.map((a) => (
            <ApprovalCardView key={a.requestId} a={a} name={sessionName(state, a.sessionId)} send={send} onSent={() => p.onApprovalSent(a.requestId)} />
          ))}
        </section>
      )}
      {active && !active.unlisted && <GoalPanel session={active} goal={state.goals[active.id]} send={send} />}
      {active?.unlisted && <p className="card muted">{active.name} isn't in sessions.json, so Sulti can only read its answers.</p>}
      <section className="stack">
        <div className="row">
          <h2>Answers</h2>
          <div className="segmented small">
            <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
              All
            </button>
            <button className={scope === "session" ? "on" : ""} onClick={() => setScope("session")} disabled={!active}>
              This session
            </button>
          </div>
        </div>
        {answers.length === 0 && <p className="muted">No answers yet. They show up here when a Codex turn finishes.</p>}
        {answers.map((a) => (
          <AnswerCard key={a.id} answer={a} name={sessionName(state, a.sessionId)} player={player} send={send} onCopyPhone={p.onCopyPhone} />
        ))}
      </section>
    </div>
  );
}

export function Composer({ state, active, send }: { state: AppState; active: SessionInfo; send: Send }) {
  const [text, setText] = useState("");
  const [skillsOpen, setSkillsOpen] = useState(false);
  const working = active.status === "working" || active.status === "waitingApproval";
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    if (send({ type: "utterance", text: t, sessionId: active.id })) setText("");
  };
  return (
    <div className="composer">
      {state.echo && <p className="echo">{state.echo}</p>}
      <textarea
        rows={2}
        value={text}
        maxLength={20000}
        placeholder={`Tell ${active.name} what to do…`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <div className="composer-actions">
        <button className="btn" onClick={() => setSkillsOpen(true)}>
          Skills
        </button>
        <button className={`btn ${working ? "danger" : ""}`} onClick={() => send({ type: "turn.interrupt", sessionId: active.id })}>
          Stop
        </button>
        <button className="btn primary grow" disabled={!text.trim()} onClick={submit}>
          Send
        </button>
      </div>
      {skillsOpen && (
        <SkillsSheet
          skills={state.skills[active.id] ?? []}
          onClose={() => setSkillsOpen(false)}
          onPick={(s) => {
            const extra = text.trim();
            if (send({ type: "skill.invoke", sessionId: active.id, skill: s.name, ...(extra ? { text: extra } : {}) })) setText("");
            setSkillsOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------- Sessions ----------

export function SessionsView({ state, send }: { state: AppState; send: Send }) {
  const [threadsFor, setThreadsFor] = useState<string | null>(null);
  const active = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
  const threads = threadsFor ? state.threads[threadsFor] : undefined;
  return (
    <div className="view stack">
      <h2>Sessions</h2>
      {state.sessions.length === 0 && <p className="muted">No sessions yet. Add projects to sessions.json on the PC.</p>}
      <ul className="list">
        {state.sessions.map((s) => (
          <li key={s.id}>
            <button className={`list-item session${s.id === state.activeSessionId ? " active" : ""}`} onClick={() => send({ type: "session.select", sessionId: s.id })}>
              <span className="row">
                <strong>{s.name}</strong>
                <StatusPill status={s.status} />
              </span>
              <span className="muted small">
                {s.id === state.activeSessionId ? "Active · " : ""}
                {s.unlisted ? "Listen-only" : s.threadId ? "Thread attached" : "No thread yet"}
                {s.aliases.length ? ` · also "${s.aliases.join('", "')}"` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {active && !active.unlisted && (
        <section className="card stack">
          <div className="row">
            <strong>Attach an existing thread to {active.name}</strong>
          </div>
          <button
            className="btn"
            onClick={() => {
              setThreadsFor(active.id);
              send({ type: "thread.list", sessionId: active.id });
            }}
          >
            {threadsFor === active.id ? "Refresh threads" : "Show threads for this folder"}
          </button>
          {threadsFor === active.id && !threads && <p className="muted">Loading…</p>}
          {threadsFor === active.id && threads?.length === 0 && <p className="muted">No threads found for this folder.</p>}
          {threadsFor === active.id && threads && threads.length > 0 && (
            <ul className="list">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    className={`list-item${t.id === active.threadId ? " active" : ""}`}
                    onClick={() => t.id !== active.threadId && confirm("Attach this thread? New prompts will continue it.") && send({ type: "thread.attach", sessionId: active.id, threadId: t.id })}
                  >
                    <strong className="clamp">{t.name ?? (t.preview || "Untitled thread")}</strong>
                    <span className="muted small">
                      {t.id === active.threadId ? "Attached · " : ""}
                      {ago(t.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

// ---------- Settings ----------

export function SettingsView(props: { settings: Settings; onChange: (s: Settings) => void; player: Player; device: Device; state: AppState; onForget: () => void }) {
  const { settings, onChange, player, device, state } = props;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const voices = [...player.voices].sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  const seg = <T extends string>(value: T, options: [T, string][], onPick: (v: T) => void) => (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? "on" : ""} aria-pressed={value === v} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <div className="view stack">
      <h2>Playback</h2>
      {seg<PlaybackMode>(settings.mode, [["A", "Phone voice"], ["B", "PC audio"]], (v) => set("mode", v))}
      <p className="muted small">
        {settings.mode === "A"
          ? "Reads answers with this phone's built-in voices. Fast, but iOS may pause it when the screen locks."
          : "The PC renders each answer to audio. Works with the lock screen and AirPods controls."}
      </p>
      {settings.mode === "A" && (
        <>
          <label className="field">
            <span>Voice</span>
            <select value={settings.voiceName ?? ""} onChange={(e) => set("voiceName", e.target.value || null)}>
              <option value="">System default</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Speed: {settings.rate.toFixed(1)}×</span>
            <input type="range" min={0.5} max={2} step={0.1} value={settings.rate} onChange={(e) => set("rate", Number(e.target.value))} />
          </label>
          <button className="btn" onClick={() => player.test()} disabled={!player.hasSpeech}>
            Test voice
          </button>
        </>
      )}
      <h2>Auto-read new answers</h2>
      {seg<AutoRead>(settings.autoRead, [["off", "Off"], ["tap", "After a tap"], ["auto", "Automatic"]], (v) => set("autoRead", v))}
      <p className="muted small">"After a tap" shows a play banner for each new answer. "Automatic" starts reading right away once you've tapped anything in the app.</p>
      <label className="toggle">
        <input type="checkbox" checked={settings.readCodeBlocks} onChange={(e) => set("readCodeBlocks", e.target.checked)} />
        <span>Read code blocks aloud (otherwise they're announced and skipped)</span>
      </label>
      <h2>This device</h2>
      <dl className="card info">
        <dt>Name</dt>
        <dd>{device.deviceName}</dd>
        <dt>Device id</dt>
        <dd>{state.deviceId ?? device.deviceId}</dd>
        <dt>Paired</dt>
        <dd>{device.pairedAt ? new Date(device.pairedAt).toLocaleString() : "Unknown"}</dd>
        <dt>Connection</dt>
        <dd>{state.conn}</dd>
        <dt>Companion</dt>
        <dd>{state.version ? `v${state.version}` : "Unknown"}</dd>
      </dl>
      <button className="btn danger" onClick={() => confirm("Forget this device? You'll need a new pairing code.") && props.onForget()}>
        Forget this device
      </button>
      <p className="muted small footer">Sulti v{APP_VERSION}. Not affiliated with OpenAI.</p>
    </div>
  );
}
