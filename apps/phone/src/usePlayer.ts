import { chunkSpeech, toSpeechText, type Answer, type PhoneMessage } from "@sulti/core";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { SpeechQueue, type QueueStatus } from "./speechQueue.js";
import type { ToastLevel } from "./state.js";
import type { PlaybackMode, Settings } from "./storage.js";
import { createWebSpeech } from "./webSpeech.js";

export type PlayStatus = "loading" | "playing" | "paused" | "done";

export interface NowPlaying {
  answerId: string;
  title: string;
  mode: PlaybackMode;
  status: PlayStatus;
}

export interface Player {
  now: NowPlaying | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  hasSpeech: boolean;
  voices: SpeechSynthesisVoice[];
  play(answer: Answer, title: string): void;
  pause(): void;
  resume(): void;
  restart(): void;
  stop(): void;
  seek(seconds: number): void;
  test(): void;
  /** Mode B: ask the PC to render this answer early so Play starts instantly. */
  prefetch(answer: Answer): void;
  onAudioUrl(answerId: string, url: string): void;
}

/** Signed audio URLs live 10 minutes; refresh a little early. */
const URL_TTL_MS = 9 * 60_000;
const SEEK_STEP = 15;

function queueToPlay(s: QueueStatus): PlayStatus {
  return s === "idle" ? "done" : s;
}

export function speechChunks(answer: Answer, readCodeBlocks: boolean): string[] {
  const text = readCodeBlocks ? toSpeechText(answer.text, { readCodeBlocks: true }) : answer.speechText || toSpeechText(answer.text);
  return chunkSpeech(text);
}

export function usePlayer(settings: Settings, send: (m: PhoneMessage) => boolean, notify: (level: ToastLevel, message: string) => void): Player {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [now, setNow] = useState<NowPlaying | null>(null);
  const nowRef = useRef<NowPlaying | null>(null);
  const update = useCallback((next: NowPlaying | null | ((n: NowPlaying | null) => NowPlaying | null)) => {
    const value = typeof next === "function" ? next(nowRef.current) : next;
    nowRef.current = value;
    setNow(value);
  }, []);

  const synth = useMemo(() => createWebSpeech(), []);
  const queue = useMemo(
    () =>
      synth
        ? new SpeechQueue(synth, {
            onChange: (st) => update((n) => (n && n.mode === "A" && n.answerId === st.answerId ? { ...n, status: queueToPlay(st.status) } : n)),
          })
        : null,
    [synth, update],
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, { url: string; at: number }>());
  const requested = useRef(new Set<string>());
  const pending = useRef<string | null>(null);

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
      a.currentTime = 0;
      a.play().catch(() => {
        // iOS refuses play() outside a tap; the Play button in the bar will work.
        update((n) => (n ? { ...n, status: "paused" } : n));
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
    if (a && a.src) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    pending.current = null;
  }, [queue]);

  const play = useCallback(
    (answer: Answer, title: string) => {
      const s = settingsRef.current;
      stopAll();
      if (s.mode === "A") {
        if (!synth || !queue) {
          notify("warn", "This browser has no speech voices. Switch to PC audio in Settings.");
          return;
        }
        synth.unlock();
        queue.rate = s.rate;
        queue.voiceName = s.voiceName;
        update({ answerId: answer.id, title, mode: "A", status: "playing" });
        queue.start(answer.id, speechChunks(answer, s.readCodeBlocks));
        return;
      }
      update({ answerId: answer.id, title, mode: "B", status: "loading" });
      if ("mediaSession" in navigator && typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({ title, artist: "Sulti", album: "Codex answer" });
      }
      const url = freshUrl(answer.id);
      if (url) return startAudio(url);
      pending.current = answer.id;
      // Bless the element inside this tap so the later play() is allowed on iOS.
      audioRef.current?.load();
      if (!requestUrl(answer.id)) update(null);
    },
    [notify, queue, requestUrl, startAudio, stopAll, synth, update],
  );

  const pause = useCallback(() => {
    const n = nowRef.current;
    if (!n) return;
    if (n.mode === "A") queue?.pause();
    else audioRef.current?.pause();
  }, [queue]);

  const resume = useCallback(() => {
    const n = nowRef.current;
    if (!n) return;
    if (n.mode === "A") {
      if (n.status === "done") queue?.restart();
      else queue?.resume();
      return;
    }
    const a = audioRef.current;
    if (a?.src) a.play().catch(() => notify("warn", "Couldn't start audio. Tap play again."));
  }, [notify, queue]);

  const restart = useCallback(() => {
    const n = nowRef.current;
    if (!n) return;
    if (n.mode === "A") return queue?.restart();
    const a = audioRef.current;
    if (!a?.src) return;
    a.currentTime = 0;
    a.play().catch(() => undefined);
  }, [queue]);

  const stop = useCallback(() => {
    stopAll();
    update(null);
  }, [stopAll, update]);

  const seek = useCallback((seconds: number) => {
    const a = audioRef.current;
    if (!a?.src) return;
    const end = Number.isFinite(a.duration) ? a.duration : Infinity;
    a.currentTime = Math.max(0, Math.min(end, a.currentTime + seconds));
  }, []);

  const test = useCallback(() => {
    if (!synth || !queue) return notify("warn", "This browser has no speech voices.");
    stopAll();
    synth.unlock();
    queue.rate = settingsRef.current.rate;
    queue.voiceName = settingsRef.current.voiceName;
    update({ answerId: "voice-test", title: "Voice test", mode: "A", status: "playing" });
    queue.start("voice-test", ["This is how Sulti will read your answers."]);
  }, [notify, queue, stopAll, synth, update]);

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
      if (pending.current === answerId) {
        pending.current = null;
        startAudio(url);
      }
    },
    [startAudio],
  );

  // Mode B: mirror the <audio> element into our state and the lock screen.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const set = (status: PlayStatus) => update((n) => (n && n.mode === "B" ? { ...n, status } : n));
    const onPlay = () => set("playing");
    const onPause = () => {
      if (!a.ended) set("paused");
    };
    const onEnded = () => set("done");
    const onError = () => {
      if (!a.getAttribute("src")) return;
      set("paused");
      notify("warn", "The audio link expired or failed. Tap play on the answer again.");
    };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
    };
  }, [notify, update]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => resume()],
      ["pause", () => pause()],
      ["stop", () => stop()],
      ["seekbackward", (d) => seek(-(d.seekOffset ?? SEEK_STEP))],
      ["seekforward", (d) => seek(d.seekOffset ?? SEEK_STEP)],
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
  }, [pause, resume, seek, stop]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = now?.mode === "B" ? (now.status === "playing" ? "playing" : "paused") : "none";
  }, [now]);

  return { now, audioRef, hasSpeech: !!synth, voices, play, pause, resume, restart, stop, seek, test, prefetch, onAudioUrl };
}
