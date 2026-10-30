import type { Answer } from "@sulti/core";
import { useApp } from "../appContext.js";
import { PlayPause } from "../screens/Listen.js";
import { elapsedOf, type NowPlaying } from "../usePlayer.js";
import { Icon, Spinner } from "./icons.js";
import { useNow } from "./parts.js";

const RING = 2 * Math.PI * 21;

/** Circular progress around a play button, filling as the answer is read. */
export function ProgressRing({ now }: { now: NowPlaying }) {
  const tick = useNow(500, now.status === "playing");
  const frac = now.duration ? Math.min(1, elapsedOf(now, tick) / now.duration) : 0;
  return (
    <svg className="ring" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="21" className="ring-track" />
      <circle cx="24" cy="24" r="21" className="ring-fill" strokeDasharray={frac * RING + " " + RING} transform="rotate(-90 24 24)" />
    </svg>
  );
}

/**
 * Play control for one answer. Idle: play. While this answer is in the player:
 * a progress ring, pause/resume, and a stop button beside it.
 */
export function AnswerControls({ answer, label }: { answer: Answer; label: string }) {
  const { player, listen } = useApp();
  const n = player.now?.answerId === answer.id && player.now.status !== "done" ? player.now : null;
  const playing = n?.status === "playing";
  return (
    <span className="answer-ctl">
      {n && (
        <button type="button" className="stop-btn press" aria-label={"Stop reading " + label} onClick={player.stop}>
          <Icon name="stop" size={16} stroke={2.2} />
        </button>
      )}
      <button
        type="button"
        className={"play-ring press" + (n ? " is-active" : "")}
        aria-label={playing ? "Pause " + label : n ? "Resume " + label : "Listen to " + label}
        disabled={n?.status === "loading"}
        onClick={() => (n ? player.toggle() : listen(answer))}
      >
        {n && <ProgressRing now={n} />}
        {n?.status === "loading" ? <Spinner size={18} /> : <PlayPause playing={playing} size={18} />}
      </button>
    </span>
  );
}

