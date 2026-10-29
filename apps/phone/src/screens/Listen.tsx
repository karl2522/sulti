import type { Answer } from "@sulti/core";
import { useEffect, useMemo, useRef } from "react";
import { useApp } from "../appContext.js";
import { ago, clock } from "../present.js";
import { buildReading, CHARS_PER_SECOND, type Block, type Reading } from "../reading.js";
import { sessionName } from "../state.js";
import { elapsedOf, type NowPlaying } from "../usePlayer.js";
import { Bars, Icon } from "../ui/icons.js";
import { Dock, PageHeader, useNow } from "../ui/parts.js";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SIZES = ["s", "m", "l"] as const;

/** Pause and play icons stacked, cross-fading on change. */
export function PlayPause({ playing, size = 18 }: { playing: boolean; size?: number }) {
  return (
    <span className={"swap" + (playing ? " on" : "")} aria-hidden="true">
      <span className="swap-a">
        <Icon name="pause" size={size} />
      </span>
      <span className="swap-b">
        <Icon name="play" size={size} />
      </span>
    </span>
  );
}

/** Inline code (between backticks) renders in the mono face. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}
    </>
  );
}

export function Listen({ answerId }: { answerId: string }) {
  const { state, player, settings, setSettings, markHeard, listen, openSheet } = useApp();
  const answer = state.answers.find((a) => a.id === answerId);
  const own = useMemo(() => (answer ? buildReading(answer.text, settings.readCodeBlocks) : null), [answer, settings.readCodeBlocks]);
  const mine = answer && player.now?.answerId === answer.id ? player.now : null;
  const r: Reading | null = mine && player.reading ? player.reading : own;
  const article = useRef<HTMLElement>(null);
  const current = mine && mine.status !== "done" ? mine.unit : -1;

  useEffect(() => {
    if (answer) markHeard(answer.id);
  }, [answer, markHeard]);

  // Keep the sentence being read in view.
  useEffect(() => {
    if (current < 0 || mine?.status !== "playing") return;
    const el = article.current?.querySelector('[data-unit="' + current + '"]');
    el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [current, mine?.status]);

  if (!answer || !r) {
    return (
      <>
        <PageHeader title="Answer" />
        <div className="scroll">
          <div className="empty" role="status">
            <h2>{state.loaded ? "This answer isn't here anymore" : "Loading…"}</h2>
            {state.loaded && <p>Sulti keeps the latest 200 answers on your PC. Older ones are cleared.</p>}
          </div>
        </div>
      </>
    );
  }

  const name = sessionName(state, answer.sessionId);
  const at = (u: number) => (mine ? player.jump(u) : listen(answer, u));
  const unitClass = (u: number) => "sent" + (u === current ? " now" : u < current ? " past" : "");
  const block = (b: Block, i: number) => {
    if (b.kind === "code") {
      return (
        <figure key={i} data-unit={b.unit} className={"code-fig " + unitClass(b.unit)} onClick={() => at(b.unit)}>
          <figcaption>
            <span className="code-label mono">
              <Icon name="code" size={16} />
              {b.lang || "code"}, {b.lines.length} {b.lines.length === 1 ? "line" : "lines"}
            </span>
            <span className="tag">{settings.readCodeBlocks ? "Read aloud" : "Skipped"}</span>
          </figcaption>
          <pre className="mono">{b.lines.join("\n")}</pre>
        </figure>
      );
    }
    return (
      <p key={i} className={"reader-" + b.tag}>
        {b.units.map((u) => (
          <span key={u} data-unit={u} className={unitClass(u)} onClick={() => at(u)}>
            <Inline text={r.units[u]!.text} />{" "}
          </span>
        ))}
      </p>
    );
  };

  return (
    <>
      <PageHeader
        title={name}
        subtitle={"Answered " + ago(answer.createdAt) + (answer.source === "hook" ? " from your terminal" : "")}
        actions={
          <>
            <button type="button" className="icon-btn press text-size" aria-label="Text size" onClick={() => setSettings({ ...settings, textSize: SIZES[(SIZES.indexOf(settings.textSize) + 1) % SIZES.length]! })}>
              Aa
            </button>
            <button type="button" className="icon-btn press" aria-label="Copy answer" onClick={() => openSheet({ kind: "copy", answer })}>
              <Icon name="copy" size={20} stroke={1.9} />
            </button>
          </>
        }
      />
      <article ref={article} className={"scroll reader size-" + settings.textSize + (current >= 0 ? " is-reading" : "")} aria-label="Answer">
        {r.blocks.map(block)}
      </article>
      <PlayerDock now={mine} reading={r} answer={answer} title={name} onPlay={() => listen(answer)} />
    </>
  );
}

function PlayerDock({ now, reading, answer, title, onPlay }: { now: NowPlaying | null; reading: Reading; answer: Answer; title: string; onPlay: () => void }) {
  const { player, settings, setSettings } = useApp();
  const tick = useNow(500, now?.status === "playing");
  const duration = now?.duration || reading.totalChars / (CHARS_PER_SECOND * settings.rate);
  const t = now ? elapsedOf(now, tick) : 0;
  const frac = duration ? Math.min(1, t / duration) : 0;
  const playing = now?.status === "playing";
  const status = !now ? "Ready to read" : now.status === "loading" ? "Preparing audio…" : now.status === "done" ? "Finished" : playing ? "Reading aloud" : "Paused";
  const pc = settings.mode === "B";

  const switchVoice = () => {
    const unit = now?.unit ?? 0;
    const wasPlaying = playing;
    setSettings({ ...settings, mode: pc ? "A" : "B" });
    // Settings apply on the next render; restart there, from the same sentence.
    if (now && wasPlaying) window.setTimeout(() => player.play(answer, title, unit), 0);
  };
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(settings.rate) + 1) % SPEEDS.length] ?? 1;
    setSettings({ ...settings, rate: next });
    player.setRate(next);
  };

  return (
    <Dock className="player">
      <div className="player-top">
        <span className={"status " + (now ? "tone-lagoon" : "tone-muted")}>
          {playing ? <Bars /> : <Icon name={now?.status === "done" ? "check" : "speaker"} size={16} stroke={2.2} />}
          <span>{status}</span>
        </span>
        <button type="button" className="chip-btn press" aria-label={"Voice: " + (pc ? "PC voice" : "phone voice") + ". Switch voice"} onClick={switchVoice}>
          <Icon name={pc ? "monitor" : "speaker"} size={16} stroke={1.9} />
          <span>{pc ? "PC voice" : "Phone voice"}</span>
        </button>
        <button type="button" className="chip-btn press tabular" aria-label={"Reading speed " + settings.rate + " times"} onClick={cycleSpeed}>
          {settings.rate}×
        </button>
      </div>
      <div className="progress">
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ transform: "scaleX(" + frac + ")" }} />
          <div className="progress-knob-wrap" style={{ transform: "translateX(" + frac * 100 + "%)" }}>
            <span className="progress-knob" />
          </div>
        </div>
        <div className="progress-meta tabular">
          <span>{clock(t)}</span>
          <span>
            Sentence {Math.min((now?.unit ?? 0) + 1, reading.units.length)} of {reading.units.length}
          </span>
          <span>{clock(duration)}</span>
        </div>
      </div>
      <div className="controls">
        <button type="button" className="ctl press" aria-label="Start over" disabled={!now} onClick={player.restart}>
          <Icon name="restart" size={22} />
        </button>
        <button type="button" className="ctl ctl-md press" aria-label="Previous sentence" disabled={!now} onClick={() => player.step(-1)}>
          <Icon name="prev" size={26} stroke={2.2} />
        </button>
        <button type="button" className={"ctl-main press" + (playing ? " is-playing" : "")} aria-label={playing ? "Pause" : "Play"} disabled={now?.status === "loading"} onClick={now ? player.toggle : onPlay}>
          <PlayPause playing={playing} size={28} />
        </button>
        <button type="button" className="ctl ctl-md press" aria-label="Next sentence" disabled={!now} onClick={() => player.step(1)}>
          <Icon name="next" size={26} stroke={2.2} />
        </button>
        <button type="button" className="ctl press" aria-label="Stop reading" disabled={!now} onClick={player.stop}>
          <Icon name="stop" size={20} />
        </button>
      </div>
    </Dock>
  );
}

