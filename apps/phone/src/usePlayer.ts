import type { Answer, PhoneMessage } from "@sulti/core";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { buildReading, CHARS_PER_SECOND, unitAt, type Reading } from "./reading.js";
import { SpeechQueue, type QueueState } from "./speechQueue.js";
import type { ToastLevel } from "./state.js";
import type { PlaybackMode, Settings } from "./storage.js";
import { createWebSpeech } from "./webSpeech.js";

export type PlayStatus = "loading" | "playing" | "paused" | "done";

export interface NowPlaying {
  answerId: string;
  sessionId: string;
  title: string;
  mode: PlaybackMode;
  status: PlayStatus;
  /** Sentence being read, and how many there are. */
  unit: number;
  units: number;
  /** Seconds: position when the clock last synced, and the most it may advance before the next sync. */
  base: number;
  cap: number;
  /** When the clock last synced (ms), or null while not advancing. */
  syncedAt: number | null;
  duration: number;
}

/** Current position in seconds, advancing smoothly between player events. */
export function elapsedOf(n: NowPlaying, nowMs = Date.now()): number {
  if (n.syncedAt === null) return n.base;
  return Math.min(n.cap, n.base + (nowMs - n.syncedAt) / 1000);
}

export interface Player {
  now: NowPlaying | null;
  /** Reading model of the answer in the player (sentences, code blocks). */
  reading: Reading | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  hasSpeech: boolean;
  voices: SpeechSynthesisVoice[];
  play(answer: Answer, title: string, fromUnit?: number): void;
  toggle(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  stop(): void;
  step(delta: number): void;
  jump(unit: number): void;
  /** Apply a new speed now (the caller saves it in settings). */
  setRate(rate: number): void;
  test(): void;
  /** PC voice: ask the PC to render this answer early so Play starts instantly. */
  prefetch(answer: Answer): void;
  onAudioUrl(answerId: string, url: string): void;
}

/** Signed audio URLs live 10 minutes; refresh a little early. */
const URL_TTL_MS = 9 * 60_000;

export function usePlayer(settings: Settings, send: (m: PhoneMessage) => boolean, notify: (level: ToastLevel, message: string) => void): Player {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [now, setNow] = useState<NowPlaying | null>(null);
  const nowRef = useRef<NowPlaying | null>(null);
  const update = useCallback((next: NowPlaying | null | ((n: NowPlaying | null) => NowPlaying | null)) => {
    nowRef.current = typeof next === "function" ? next(nowRef.current) : next;
    setNow(nowRef.current);
  }, []);
  const [reading, setReading] = useState<Reading | null>(null);
  const readingRef = useRef<Reading | null>(null);
  const current = useRef<{ answer: Answer; title: string } | null>(null);

  const synth = useMemo(() => createWebSpeech(), []);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, { url: string; at: number }>());
  const requested = useRef(new Set<string>());
  const pending = useRef<{ id: string; fraction: number } | null>(null);

  // Phone voice: the queue reports chunk changes; turn them into sentence + estimated time.
  const onQueue = useCallback(
    (st: QueueState) => {
      const r = readingRef.current;
      update((n) => {
        if (!n || n.mode !== "A" || n.answerId !== st.answerId || !r) return n;
        const cps = CHARS_PER_SECOND * settingsRef.current.rate;
        const chunk = Math.min(st.index, r.chunkUnit.length - 1);
        const unit = r.chunkUnit[chunk] ?? 0;
        const status: PlayStatus = st.status === "idle" ? "done" : st.status;
        const base = status === "done" ? r.totalChars / cps : r.offsets[unit]! / cps;
        const cap = unit + 1 < r.offsets.length ? r.offsets[unit + 1]! / cps : r.totalChars / cps;
        return { ...n, status, unit: status === "done" ? r.units.length - 1 : unit, base, cap, syncedAt: status === "playing" ? Date.now() : null, duration: r.totalChars / cps };
      });
    },
    [update],
  );
  const queue = useMemo(() => (synth ? new SpeechQueue(synth, { onChange: onQueue }) : null), [synth, onQueue]);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synth?.voices() ?? []);
  useEffect(() => {
    const ss = globalThis.speechSynthesis;
    if (!ss) return;
    const load = () => setVoices(ss.getVoices());
    ss.addEventListener?.("voiceschanged", load);
    load();
    return () => ss.removeEventListener?.("voiceschanged", load);
  }, []);

  const freshUrl = (id: string) => {
    const u = urls.current.get(id);
    return u && Date.now() - u.at < URL_TTL_MS ? u.url : null;
  };

  const startAudio = useCallback(
    (url: string) => {
      const a = audioRef.current;
      if (!a) return;
      a.src = url;
      a.playbackRate = settingsRef.current.rate;
      a.play().catch(() => {
        // iOS refuses play() outside a tap; the play button will work.
        update((n) => (n ? { ...n, status: "paused", syncedAt: null } : n));
        notify("info", "Audio is ready. Tap play.");
      });
    },
    [notify, update],
  );

  const requestUrl = useCallback(
    (id: string) => {
      requested.current.add(id);
      return send({ type: "answer.audioUrl", answerId: id });
    },
    [send],
  );

  const stopAll = useCallback(() => {
    queue?.stop();
    const a = audioRef.current;
    if (a?.getAttribute("src")) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    pending.current = null;
  }, [queue]);

  const play = useCallback(
    (answer: Answer, title: string, fromUnit = 0) => {
      const s = settingsRef.current;
      stopAll();
      const r = buildReading(answer.text, s.readCodeBlocks);
      readingRef.current = r;
      setReading(r);
      current.current = { answer, title };
      const unit = Math.max(0, Math.min(fromUnit, r.units.length - 1));
      const base: NowPlaying = { answerId: answer.id, sessionId: answer.sessionId, title, mode: s.mode, status: "loading", unit, units: r.units.length, base: 0, cap: 0, syncedAt: null, duration: 0 };
      if (s.mode === "A") {
        if (!synth || !queue) {
          update(null);
          return notify("warn", "This browser has no voices. Switch to PC voice in Settings.");
        }
        synth.unlock();
        queue.rate = s.rate;
        queue.voiceName = s.voiceName;
        update({ ...base, status: "playing" });
        queue.start(answer.id, r.chunks, r.firstChunk[unit] ?? 0);
        return;
      }
      update(base);
      if ("mediaSession" in navigator && typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({ title, artist: "Sulti", album: "Codex answer" });
      }
      const fraction = r.totalChars ? r.offsets[unit]! / r.totalChars : 0;
      pending.current = { id: answer.id, fraction };
      const url = freshUrl(answer.id);
      if (url) return startAudio(url);
      if (!requestUrl(answer.id)) update(null);
    },
    [notify, queue, requestUrl, startAudio, stopAll, synth, update],
  );

  const pause = useCallback(() => {
    const n = nowRef.current;
    if (!n || n.status !== "playing") return;
    if (n.mode === "A") queue?.pause();
    else audioRef.current?.pause();
  }, [queue]);

  const resume = useCallback(() => {
    const n = nowRef.current;
    const cur = current.current;
    if (!n) return;
    if (n.status === "done" && cur) return play(cur.answer, cur.title, 0);
    if (n.mode === "A") return queue?.resume();
    const a = audioRef.current;
    if (a?.getAttribute("src")) a.play().catch(() => notify("warn", "Couldn't start audio. Tap play again."));
  }, [notify, play, queue]);

  const toggle = useCallback(() => (nowRef.current?.status === "playing" ? pause() : resume()), [pause, resume]);

  const jump = useCallback(
    (unit: number) => {
      const n = nowRef.current;
      const r = readingRef.current;
      if (!n || !r) return;
      const u = Math.max(0, Math.min(unit, r.units.length - 1));
      if (n.mode === "A") return queue?.jump(r.firstChunk[u] ?? 0);
      const a = audioRef.current;
      if (!a?.getAttribute("src") || !Number.isFinite(a.duration)) return;
      a.currentTime = (r.offsets[u]! / r.totalChars) * a.duration;
      if (a.paused) a.play().catch(() => undefined);
    },
    [queue],
  );

  const step = useCallback((delta: number) => jump((nowRef.current?.unit ?? 0) + delta), [jump]);
  const restart = useCallback(() => jump(0), [jump]);

  const stop = useCallback(() => {
    stopAll();
    update(null);
  }, [stopAll, update]);

  const setRate = useCallback(
    (rate: number) => {
      const n = nowRef.current;
      if (queue) queue.rate = rate;
      if (audioRef.current) audioRef.current.playbackRate = rate;
      // Web Speech can't change the rate of a sentence in flight: re-speak it.
      if (n?.mode === "A" && n.status === "playing" && queue) queue.jump(queue.state.index);
    },
    [queue],
  );

  const test = useCallback(() => {
    if (!synth || !queue) return notify("warn", "This browser has no voices.");
    stop();
    synth.unlock();
    queue.rate = settingsRef.current.rate;
    queue.voiceName = settingsRef.current.voiceName;
    queue.start("voice-test", ["This is how Sulti will read your answers."]);
  }, [notify, queue, stop, synth]);

  const prefetch = useCallback(
    (answer: Answer) => {
      if (settingsRef.current.mode !== "B" || freshUrl(answer.id) || requested.current.has(answer.id)) return;
      requestUrl(answer.id);
    },
    [requestUrl],
  );

  const onAudioUrl = useCallback(
    (answerId: string, url: string) => {
      requested.current.delete(answerId);
      urls.current.set(answerId, { url, at: Date.now() });
      if (pending.current?.id === answerId && !audioRef.current?.getAttribute("src")) startAudio(url);
    },
    [startAudio],
  );

  // PC voice: mirror the <audio> element into our state and the lock screen.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const sync = (status?: PlayStatus) =>
      update((n) => {
        if (!n || n.mode !== "B") return n;
        const r = readingRef.current;
        const d = Number.isFinite(a.duration) ? a.duration : n.duration;
        const s = status ?? n.status;
        const t = a.currentTime;
        return { ...n, status: s, duration: d, base: t, cap: t + 1, syncedAt: s === "playing" ? Date.now() : null, unit: r && d ? unitAt(r, t / d) : n.unit };
      });
    const onMeta = () => {
      const p = pending.current;
      if (p && p.fraction > 0 && Number.isFinite(a.duration)) a.currentTime = p.fraction * a.duration;
      pending.current = null;
      sync();
    };
    const onPause = () => sync(a.ended ? "done" : "paused");
    const onError = () => {
      if (!a.getAttribute("src")) return;
      sync("paused");
      notify("warn", "The audio link expired. Tap play again.");
    };
    const handlers: [string, () => void][] = [
      ["loadedmetadata", onMeta],
      ["play", () => sync("playing")],
      ["playing", () => sync("playing")],
      ["timeupdate", () => sync()],
      ["pause", onPause],
      ["ended", () => sync("done")],
      ["error", onError],
    ];
    for (const [e, h] of handlers) a.addEventListener(e, h);
    return () => {
      for (const [e, h] of handlers) a.removeEventListener(e, h);
    };
  }, [notify, update]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const seekBy = (s: number) => {
      const a = audioRef.current;
      if (a?.getAttribute("src")) a.currentTime = Math.max(0, Math.min(Number.isFinite(a.duration) ? a.duration : Infinity, a.currentTime + s));
    };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => resume()],
      ["pause", () => pause()],
      ["stop", () => stop()],
      ["seekbackward", (d) => seekBy(-(d.seekOffset ?? 15))],
      ["seekforward", (d) => seekBy(d.seekOffset ?? 15)],
      ["previoustrack", () => step(-1)],
      ["nexttrack", () => step(1)],
    ];
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // Older Safari doesn't know every action.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [pause, resume, step, stop]);

  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = now?.mode === "B" ? (now.status === "playing" ? "playing" : "paused") : "none";
  }, [now]);

  return { now, reading, audioRef, hasSpeech: !!synth, voices, play, toggle, pause, resume, restart, stop, step, jump, setRate, test, prefetch, onAudioUrl };
}

