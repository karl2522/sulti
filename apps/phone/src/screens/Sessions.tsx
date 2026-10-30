import { useApp } from "../appContext.js";
import { clock, viewSession, type SessionView } from "../present.js";
import { navigate } from "../router.js";
import { elapsedOf } from "../usePlayer.js";
import { AnswerControls, ProgressRing } from "../ui/AnswerControls.js";
import { Icon, Logo, Mark } from "../ui/icons.js";
import { Avatar, Dock, nth, SkeletonList, StatusLine, useNow } from "../ui/parts.js";
import { PlayPause } from "./Listen.js";

export function Sessions() {
  const { state, heard, player, openSheet } = useApp();
  const now = useNow(30_000);
  const n = player.now;
  const playing = n && n.status !== "done" ? { sessionId: n.sessionId, answerId: n.answerId, paused: n.status === "paused" } : null;
  const views = state.sessions.map((s) => viewSession(state, s, heard, playing, now));
  const needs = views.filter((v) => v.needsYou);
  const others = views.filter((v) => !v.needsYou);
  const talkTo = state.sessions.find((s) => s.id === state.activeSessionId && !s.unlisted) ?? state.sessions.find((s) => !s.unlisted);
  const conn = state.conn === "open" ? (state.host ?? "Your PC") : state.conn === "connecting" ? "Connecting…" : "Offline";

  return (
    <>
      <header className="bar bar-home">
        <Logo />
        <div className="bar-actions">
          <button type="button" className={"conn-pill press conn-" + state.conn} onClick={() => openSheet({ kind: "settings" })} aria-label={"Connection: " + conn}>
            <span className="conn-dot" />
            <span>{conn}</span>
          </button>
          <button type="button" className="icon-btn press" aria-label="Settings" onClick={() => openSheet({ kind: "settings" })}>
            <Icon name="settings" size={22} stroke={1.8} />
          </button>
        </div>
      </header>
      <div className={"scroll with-dock" + (player.now ? " tall" : "")}>
        <h1 className="title">Sessions</h1>
        {!state.loaded ? (
          <SkeletonList />
        ) : !views.length ? (
          <div className="empty" role="status">
            <Mark height={40} />
            <h2>No sessions yet</h2>
            <p>List your projects in sessions.json on your PC, or finish a turn in a Codex terminal. Sessions show up here.</p>
          </div>
        ) : (
          <>
            {needs.length > 0 && <Group title="Needs you" views={needs} offset={0} activeId={state.activeSessionId} />}
            {others.length > 0 && <Group title={needs.length ? "Other sessions" : "Your sessions"} views={others} offset={needs.length} activeId={state.activeSessionId} />}
          </>
        )}
      </div>
      <Dock>
        {player.now && <MiniPlayer />}
        {talkTo && (
          <button type="button" className="btn btn-primary btn-dock press" onClick={() => navigate("/talk?to=" + encodeURIComponent(talkTo.id))}>
            <Icon name="mic" size={20} stroke={2.2} />
            <span>Talk to {talkTo.name}</span>
          </button>
        )}
      </Dock>
    </>
  );
}

function Group({ title, views, offset, activeId }: { title: string; views: SessionView[]; offset: number; activeId: string | null }) {
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      <ul className="group">
        {views.map((v, i) => (
          <SessionRow key={v.session.id} v={v} i={offset + i} active={v.session.id === activeId} />
        ))}
      </ul>
    </section>
  );
}

function SessionRow({ v, i, active }: { v: SessionView; i: number; active: boolean }) {
  const { openSheet } = useApp();
  const { session, answer, approval } = v;
  const ready = v.icon === "speaker" || v.icon === "bars";
  const open = () => {
    if (approval) openSheet({ kind: "approval", requestId: approval.requestId });
    else if (ready && answer) navigate("/a/" + encodeURIComponent(answer.id));
    else navigate("/s/" + encodeURIComponent(session.id));
  };
  return (
    <li className="row stagger" style={nth(i)}>
      <button type="button" className="row-main press-row" onClick={open}>
        <Avatar session={session} tone={v.tone} />
        <span className="row-text">
          <span className="row-title">
            <span className="truncate">{session.name}</span>
            {active && !session.unlisted && <span className="tag">Active</span>}
          </span>
          <StatusLine view={v} />
          <span className={"row-detail truncate" + (v.detailMono ? " mono" : "")}>{v.detail}</span>
        </span>
        {approval ? (
          <span className="chip chip-coral">Review</span>
        ) : (
          !(ready && answer) && (
            <span className="chev">
              <Icon name="chevronRight" size={20} />
            </span>
          )
        )}
      </button>
      {!approval && ready && answer && <AnswerControls answer={answer} label={"the " + session.name + " answer"} />}
    </li>
  );
}

export function MiniPlayer() {
  const { player } = useApp();
  const n = player.now!;
  const tick = useNow(500, n.status === "playing");
  const t = elapsedOf(n, tick);
  const label = n.status === "loading" ? "Preparing audio…" : n.status === "done" ? "Finished" : (n.status === "playing" ? "Reading, " : "Paused, ") + clock(t) + " of " + clock(n.duration);
  const open = () => navigate("/a/" + encodeURIComponent(n.answerId));
  return (
    <div className="mini">
      <button type="button" className="ring-btn press" aria-label={n.status === "playing" ? "Pause reading" : "Play"} onClick={player.toggle} disabled={n.status === "loading"}>
        <ProgressRing now={n} />
        <PlayPause playing={n.status === "playing"} size={18} />
      </button>
      <button type="button" className="mini-text" onClick={open}>
        <strong className="truncate">{n.title}</strong>
        <span className="tabular">{label}</span>
      </button>
      <button type="button" className="icon-btn press" aria-label="Stop reading" onClick={player.stop}>
        <Icon name="stop" size={20} stroke={2} />
      </button>
      <button type="button" className="icon-btn press" aria-label="Open player" onClick={open}>
        <Icon name="chevronUp" size={22} stroke={2.2} />
      </button>
    </div>
  );
}
