import { route, type Intent, type SessionInfo } from "@sulti/core";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../appContext.js";
import { initials } from "../present.js";
import { back } from "../router.js";
import { sessionName, type AppState } from "../state.js";
import { Icon } from "../ui/icons.js";
import { Dock } from "../ui/parts.js";

const CHIPS = 6;
const STATUS: Record<SessionInfo["status"], string> = { idle: "Idle", working: "Working", waitingApproval: "Needs approval", error: "Last turn failed" };

/** What the preview card says about a routed intent: [type, body, runs on the phone]. */
function describe(intent: Intent): [string, string, boolean] {
  if (intent.kind === "prompt") return ["Prompt to Codex", intent.text, false];
  if (intent.kind === "codex") {
    const a = intent.action;
    if (a.type === "goal.set") return ["Set the goal", a.objective, false];
    if (a.type === "goal.get") return ["Read the current goal", "", false];
    if (a.type === "goal.update") return [a.status === "paused" ? "Pause the goal" : "Resume the goal", "", false];
    if (a.type === "goal.clear") return ["Clear the goal", "", false];
    if (a.type === "interrupt") return ["Stop the current turn", "", false];
    return ["Skill $" + a.skill, a.text ?? "", false];
  }
  const a = intent.action;
  if (a.type === "switchSession") return ["Switch session", a.spoken, true];
  if (a.type === "playback") return ["Playback: " + a.playback, "", true];
  if (a.type === "copy") return ["Copy the answer", "", true];
  return ["Show approvals", "Approvals always need a tap.", true];
}

function heardAs(state: AppState, intent: Intent, text: string): string | null {
  const id = "sessionId" in intent ? intent.sessionId : intent.action.type === "switchSession" ? intent.action.sessionId : null;
  const s = id ? state.sessions.find((x) => x.id === id) : null;
  const said = text.toLowerCase();
  return s?.aliases.find((a) => said.includes(a.toLowerCase())) ?? null;
}

export function Talk({ query }: { query: URLSearchParams }) {
  const { state, send, openSheet } = useApp();
  const listed = useMemo(() => state.sessions.filter((s) => !s.unlisted), [state.sessions]);
  const [to, setTo] = useState(() => query.get("to") ?? state.activeSessionId ?? "");
  const [skill, setSkill] = useState<string | null>(() => query.get("skill"));
  const [text, setText] = useState("");
  const target = listed.find((s) => s.id === to) ?? listed[0];
  const skills = useMemo(() => (target ? (state.skills[target.id] ?? []) : []), [target, state.skills]);

  // Skills load per session; ask for them when talking to one we haven't opened.
  useEffect(() => {
    if (target && !state.skills[target.id] && state.conn === "open") send({ type: "session.select", sessionId: target.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, state.conn]);

  const routed = useMemo(() => (target && text.trim() && !skill ? route(text, { sessions: listed, skills, activeSessionId: target.id }) : null), [target, text, skill, listed, skills]);

  if (!target) {
    return (
      <>
        <TalkHeader />
        <div className="scroll">
          <div className="empty" role="status">
            <h2>No session to talk to</h2>
            <p>List a project in sessions.json on your PC to send it prompts.</p>
          </div>
        </div>
      </>
    );
  }

  const canSend = !!skill || !!routed?.intent;
  const submit = () => {
    const t = text.trim();
    const ok = skill ? send({ type: "skill.invoke", sessionId: target.id, skill, ...(t ? { text: t } : {}) }) : t ? send({ type: "utterance", text: t, sessionId: target.id }) : false;
    if (ok) back();
  };
  const first = skills.slice(0, CHIPS).map((k) => k.name);
  const chips = skill && !first.includes(skill) ? [skill, ...first.slice(0, CHIPS - 1)] : first;

  let card: [string, string, boolean] | null = null;
  let note: string | null = null;
  let sessionLine = target.name;
  let heard: string | null = null;
  if (skill) card = ["Skill $" + skill, text.trim(), false];
  else if (routed?.intent) {
    card = describe(routed.intent);
    if ("sessionId" in routed.intent) sessionLine = sessionName(state, routed.intent.sessionId);
    heard = heardAs(state, routed.intent, text);
    if (routed.intent.needsConfirm) note = "Sulti isn't sure, so it will ask you before doing this.";
  } else if (routed) note = routed.echo;

  return (
    <>
      <TalkHeader />
      <div className="scroll with-dock talk">
        <div className="to-row">
          <span className="muted">To</span>
          <button type="button" className="to-btn press" aria-label={"Change session, currently " + target.name} onClick={() => openSheet({ kind: "pickSession", title: "Send to", onPick: setTo })}>
            <span className="avatar avatar-sm">{initials(target.name)}</span>
            <span className="to-name truncate">{target.name}</span>
            <Icon name="chevronDown" size={18} stroke={2.2} />
          </button>
          <span className="to-status">{STATUS[target.status]}</span>
        </div>
        <label className="sr-only" htmlFor="talk-message">
          Message
        </label>
        <textarea id="talk-message" className="talk-input" rows={3} value={text} maxLength={20000} placeholder={skill ? "Add details for the skill (optional)" : "Tell " + target.name + " what to do…"} onChange={(e) => setText(e.target.value)} autoFocus />
        <p className="hint">
          <Icon name="mic" size={16} />
          <span>Tap the mic on your keyboard to dictate.</span>
        </p>

        {(card || note) && (
          <section className="card route-card" aria-live="polite">
            <h2 className="section-title">Sulti will send</h2>
            {card && (
              <dl className="kv">
                <dt>Session</dt>
                <dd>
                  <strong>{sessionLine}</strong>
                  {heard && <span className="muted"> heard as “{heard}”</span>}
                </dd>
                <dt>Type</dt>
                <dd key={card[0]} className="fade-in">
                  {card[0]}
                </dd>
              </dl>
            )}
            {card?.[1] && <p className="route-body">{card[1]}</p>}
            {note && <p className="route-note">{note}</p>}
            <p className="fine">
              <Icon name="lock" size={16} />
              <span>{card?.[2] ? "This runs on your phone, not on the PC." : "Codex runs commands in its sandbox and asks you before anything outside it."}</span>
            </p>
          </section>
        )}

        {skills.length > 0 && (
          <section className="section">
            <h2 className="section-title">{skill ? "Skill" : "Add a skill"}</h2>
            <div className="chips">
              {chips.map((name) => (
                <button key={name} type="button" className={"skill-chip mono press" + (skill === name ? " on" : "")} aria-pressed={skill === name} onClick={() => setSkill(skill === name ? null : name)}>
                  {"$" + name}
                </button>
              ))}
              {skills.length > CHIPS && (
                <button type="button" className="skill-chip press" onClick={() => openSheet({ kind: "skills", sessionId: target.id, onPick: setSkill })}>
                  All {skills.length}…
                </button>
              )}
            </div>
          </section>
        )}
      </div>
      <Dock>
        <button type="button" className="btn btn-primary btn-dock press" disabled={!canSend} onClick={submit}>
          <Icon name="send" size={20} stroke={2.4} />
          <span className="truncate">Send to {sessionLine}</span>
        </button>
      </Dock>
    </>
  );
}

function TalkHeader() {
  return (
    <header className="bar bar-center">
      <button type="button" className="icon-btn press" aria-label="Close" onClick={() => back()}>
        <Icon name="close" size={22} stroke={2.2} />
      </button>
      <span className="bar-name">New message</span>
      <span />
    </header>
  );
}

