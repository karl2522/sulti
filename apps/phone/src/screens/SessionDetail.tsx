import type { ActivityItem, Goal, SessionInfo } from "@sulti/core";
import { useEffect, useState } from "react";
import { useApp } from "../appContext.js";
import { activityVerb, ago, firstLine, span } from "../present.js";
import { navigate } from "../router.js";
import { latestAnswer } from "../state.js";
import { Icon, Spinner, type IconName } from "../ui/icons.js";
import { Dock, nth, PageHeader, useNow } from "../ui/parts.js";

const ACTIVITY_ICON: Record<ActivityItem["kind"], IconName> = { read: "file", search: "search", list: "folder", command: "terminal", edit: "pencil" };
const SKILLS_SHOWN = 5;

export function SessionDetail({ id }: { id: string }) {
  const { state, send, openSheet, listen } = useApp();
  const s = state.sessions.find((x) => x.id === id);
  const now = useNow(1000, s?.status === "working");

  // Opening a session makes it the active one: its skills and goal load, and Talk goes to it.
  useEffect(() => {
    if (s && !s.unlisted && state.conn === "open" && state.activeSessionId !== s.id) send({ type: "session.select", sessionId: s.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.id, state.conn]);

  if (!s) {
    return (
      <>
        <PageHeader title="Session" />
        <div className="scroll">
          <div className="empty" role="status">
            <h2>{state.loaded ? "No session called " + id : "Loading…"}</h2>
          </div>
        </div>
      </>
    );
  }

  const approval = state.approvals.find((a) => a.sessionId === s.id);
  const activity = state.activity[s.id] ?? [];
  const skills = state.skills[s.id] ?? [];
  const answer = latestAnswer(state, s.id);
  const busy = s.status === "working" || s.status === "waitingApproval";
  const talk = (skill?: string) => navigate("/talk?to=" + encodeURIComponent(s.id) + (skill ? "&skill=" + encodeURIComponent(skill) : ""));
  let i = 0;

  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={s.id}
        mono
        actions={
          !s.unlisted && (
            <button type="button" className="icon-btn press" aria-label="Attach an existing thread" onClick={() => openSheet({ kind: "threads", sessionId: s.id })}>
              <Icon name="dots" size={22} />
            </button>
          )
        }
      />
      <div className={"scroll" + (s.unlisted ? "" : " with-dock")}>
        <div className="chip-row">
          {approval ? (
            <button type="button" className="state-chip chip-coral press" onClick={() => openSheet({ kind: "approval", requestId: approval.requestId })}>
              <Icon name="shield" size={14} stroke={2.4} />
              <span>Needs approval</span>
              <Icon name="chevronRight" size={16} stroke={2.4} />
            </button>
          ) : s.status === "working" ? (
            <span className="state-chip chip-lilac">
              <Spinner size={14} />
              <span className="tabular">Working{s.since ? " for " + span((now - s.since) / 1000) : ""}</span>
            </span>
          ) : s.status === "error" ? (
            <span className="state-chip chip-coral">Last turn failed</span>
          ) : (
            <span className="state-chip chip-muted">{s.unlisted ? "Listen only" : "Idle"}</span>
          )}
        </div>

        {s.unlisted && <p className="lead">This terminal isn't in sessions.json, so Sulti only reads its answers. Add the folder there to send it prompts.</p>}
        {!s.unlisted && <GoalCard s={s} goal={state.goals[s.id]} i={i++} />}

        {answer && (
          <section className="section stagger" style={nth(i++)}>
            <h2 className="section-title">Latest answer</h2>
            <div className="card answer-card">
              <button type="button" className="answer-open" onClick={() => navigate("/a/" + encodeURIComponent(answer.id))}>
                <span className="answer-snippet">{firstLine(answer.text, 220)}</span>
                <span className="answer-meta">
                  {ago(answer.createdAt)}
                  {answer.source === "hook" ? ", from a terminal" : ""}
                </span>
              </button>
              <button type="button" className="play-ring press" aria-label="Listen to this answer" onClick={() => listen(answer)}>
                <Icon name="play" size={18} />
              </button>
            </div>
          </section>
        )}

        {activity.length > 0 && (
          <section className="section stagger" style={nth(i++)} aria-label="Right now">
            <h2 className="section-title">{busy ? "Right now" : "Last turn"}</h2>
            <ol className="activity">
              {activity.map((a) => (
                <li key={a.id} className={"act act-" + a.status}>
                  <Icon name={ACTIVITY_ICON[a.kind]} size={18} stroke={1.9} />
                  <span className="act-text">
                    {activityVerb(a)} <span className="mono">{a.text}</span>
                    {a.status === "failed" ? ", failed" : ""}
                  </span>
                  {a.status === "running" && <span className="act-now">Now</span>}
                </li>
              ))}
            </ol>
          </section>
        )}

        {!s.unlisted && skills.length > 0 && (
          <section className="section stagger" style={nth(i++)}>
            <h2 className="section-title">Skills in this project</h2>
            <ul className="group">
              {skills.slice(0, SKILLS_SHOWN).map((k) => (
                <li key={k.path || k.name} className="row skill-row">
                  <span className="row-text">
                    <span className="mono skill-name truncate">{k.name}</span>
                    {k.description && <span className="row-detail clamp-2">{k.description}</span>}
                  </span>
                  <button type="button" className="btn btn-soft press" aria-label={"Use " + k.name} onClick={() => talk(k.name)}>
                    Use
                  </button>
                </li>
              ))}
            </ul>
            {skills.length > SKILLS_SHOWN && (
              <button type="button" className="link-btn press" onClick={() => openSheet({ kind: "skills", sessionId: s.id, onPick: talk })}>
                Show all {skills.length} skills
              </button>
            )}
          </section>
        )}
      </div>

      {!s.unlisted && (
        <Dock className={busy ? "dock-split" : ""}>
          {busy && (
            <button type="button" className="btn btn-outline btn-dock press" onClick={() => send({ type: "turn.interrupt", sessionId: s.id })}>
              <Icon name="stop" size={18} stroke={2.2} />
              <span>Stop turn</span>
            </button>
          )}
          <button type="button" className="btn btn-primary btn-dock press" onClick={() => talk()}>
            <Icon name="mic" size={20} stroke={2.2} />
            <span>Talk</span>
          </button>
        </Dock>
      )}
    </>
  );
}

const GOAL_STATUS: Record<Goal["status"], [string, string]> = {
  active: ["Active", "chip-lilac"],
  paused: ["Paused", "chip-muted"],
  blocked: ["Blocked", "chip-coral"],
  usageLimited: ["Usage limit", "chip-coral"],
  budgetLimited: ["Budget reached", "chip-coral"],
  complete: ["Complete", "chip-lagoon"],
};

function GoalCard({ s, goal, i }: { s: SessionInfo; goal: Goal | null | undefined; i: number }) {
  const { send } = useApp();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const save = () => {
    const objective = text.trim();
    if (objective && send({ type: "goal.set", sessionId: s.id, objective })) setEditing(false);
  };
  const [label, chip] = goal ? GOAL_STATUS[goal.status] : ["", ""];

  return (
    <section className="card goal stagger" style={nth(i)} aria-label="Goal">
      <div className="goal-head">
        <h2 className="section-title">
          <Icon name="flag" size={16} />
          <span>Goal</span>
        </h2>
        {goal && <span className={"state-chip sm " + chip}>{label}</span>}
      </div>
      {editing ? (
        <>
          <textarea className="field goal-input" rows={3} maxLength={4000} value={text} autoFocus placeholder="What should Codex work toward?" onChange={(e) => setText(e.target.value)} aria-label="Goal" />
          <div className="btn-row">
            <button type="button" className="btn btn-soft press" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary press" disabled={!text.trim()} onClick={save}>
              {goal ? "Save goal" : "Set goal"}
            </button>
          </div>
        </>
      ) : goal === undefined ? (
        <span className="sk sk-line" aria-label="Loading goal" />
      ) : goal ? (
        <>
          <p className="goal-text">{goal.objective}</p>
          <div className="btn-row">
            {goal.status === "active" ? (
              <button type="button" className="btn btn-soft press" onClick={() => send({ type: "goal.update", sessionId: s.id, status: "paused" })}>
                <Icon name="pause" size={14} />
                <span>Pause</span>
              </button>
            ) : (
              goal.status !== "complete" && (
                <button type="button" className="btn btn-soft press" onClick={() => send({ type: "goal.update", sessionId: s.id, status: "active" })}>
                  <Icon name="play" size={14} />
                  <span>Resume</span>
                </button>
              )
            )}
            <button type="button" className="btn btn-soft press" onClick={() => (setText(goal.objective), setEditing(true))}>
              Edit
            </button>
            <button type="button" className={"btn btn-soft press danger" + (armed ? " armed" : "")} onClick={() => (armed ? (send({ type: "goal.clear", sessionId: s.id }), setArmed(false)) : setArmed(true))}>
              {armed ? "Tap to clear" : "Clear"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="goal-empty">No goal yet. A goal keeps Codex working toward one outcome, turn after turn.</p>
          <div className="btn-row">
            <button type="button" className="btn btn-soft press" onClick={() => (setText(""), setEditing(true))}>
              Set a goal
            </button>
          </div>
        </>
      )}
    </section>
  );
}
