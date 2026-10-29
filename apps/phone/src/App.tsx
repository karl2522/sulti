import type { Answer, CompanionMessage, PhoneMessage } from "@sulti/core";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Connection } from "./connection.js";
import { PairScreen, Unpaired } from "./PairScreen.js";
import { planRoute, type AppAction, type RoutePlan } from "./routePlan.js";
import { initialState, reducer, sessionName, type ToastLevel } from "./state.js";
import { forgetDevice, loadDevice, loadSettings, saveDevice, saveSettings, type Device, type Settings } from "./storage.js";
import { usePlayer } from "./usePlayer.js";
import { BottomNav, Composer, ConfirmSheet, NowPlayingBar, SessionsView, SettingsView, TalkView, Toasts, TopBar, type View } from "./views.js";

export function App() {
  const [device, setDevice] = useState<Device | null>(loadDevice);
  const [path, setPath] = useState(location.pathname);

  if (path === "/pair") {
    return (
      <PairScreen
        onPaired={(d) => {
          saveDevice(d);
          // Drop the one-time code from the address bar and history.
          history.replaceState(null, "", "/");
          setPath("/");
          setDevice(d);
        }}
      />
    );
  }
  if (!device) return <Unpaired />;
  return (
    <Main
      key={device.deviceToken}
      device={device}
      onForget={() => {
        forgetDevice();
        setDevice(null);
      }}
    />
  );
}

type PendingConfirm = Extract<RoutePlan, { kind: "confirm" } | { kind: "local" }>;

/** Answers that arrive this soon after auth are the companion's backlog, not new. */
const BACKLOG_WINDOW_MS = 1500;
const TOAST_MS = 4500;

function Main({ device, onForget }: { device: Device; onForget: () => void }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [view, setView] = useState<View>("talk");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [banner, setBanner] = useState<Answer | null>(null);
  const connRef = useRef<Connection | null>(null);
  const authedAt = useRef(0);
  const seen = useRef(new Set<string>());
  const tapped = useRef(false);

  const notify = useCallback((level: ToastLevel, message: string) => dispatch({ type: "toast", level, message }), []);
  const send = useCallback(
    (m: PhoneMessage) => {
      const ok = connRef.current?.send(m) ?? false;
      if (!ok) notify("warn", "Not connected to the PC right now.");
      return ok;
    },
    [notify],
  );
  const player = usePlayer(settings, send, notify);

  const setSettings = (s: Settings) => {
    saveSettings(s);
    setSettingsState(s);
  };

  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const latestAnswer = (): Answer | null => {
    const s = stateRef.current;
    return s.answers.find((a) => a.sessionId === s.activeSessionId) ?? s.answers[0] ?? null;
  };

  const copyOnPhone = async (a: Answer) => {
    try {
      await navigator.clipboard.writeText(a.text);
      notify("info", "Copied.");
    } catch {
      notify("warn", "The phone blocked copying. Tap Copy on phone on the answer.");
    }
  };

  const runLocal = (action: Exclude<AppAction, { type: "switchSession" }>) => {
    const latest = latestAnswer();
    const title = latest ? sessionName(stateRef.current, latest.sessionId) : "";
    switch (action.type) {
      case "playback":
        switch (action.playback) {
          case "read":
            return latest ? player.play(latest, title) : notify("info", "No answers yet.");
          case "again":
          case "restart":
            if (player.now) return player.restart();
            return latest ? player.play(latest, title) : notify("info", "No answers yet.");
          case "pause":
            return player.pause();
          case "resume":
            return player.resume();
          case "stop":
            return player.stop();
        }
        return;
      case "copy":
        if (!latest) return notify("info", "No answers to copy yet.");
        if (action.target === "phone") return void copyOnPhone(latest);
        if (action.target === "pc") return void send({ type: "answer.copyToPc", answerId: latest.id });
        setView("talk");
        return notify("info", "Use Copy on phone or Copy to PC on the answer.");
      case "showApprovals":
        setView("talk");
        if (!stateRef.current.approvals.length) return notify("info", "Nothing is waiting for approval.");
        requestAnimationFrame(() => document.getElementById("approvals")?.scrollIntoView({ behavior: "smooth" }));
        return;
    }
  };

  const onNewAnswer = (a: Answer) => {
    if (seen.current.has(a.id)) return;
    seen.current.add(a.id);
    if (Date.now() - authedAt.current < BACKLOG_WINDOW_MS) return;
    player.prefetch(a);
    const mode = settingsRef.current.autoRead;
    if (mode === "auto" && tapped.current) player.play(a, sessionName(stateRef.current, a.sessionId));
    else if (mode !== "off") setBanner(a);
  };

  const handle = (m: CompanionMessage) => {
    switch (m.type) {
      case "auth.ok":
        authedAt.current = Date.now();
        return;
      case "answer": {
        const { type: _t, ...a } = m;
        return onNewAnswer(a);
      }
      case "audio.url":
        return player.onAudioUrl(m.answerId, m.url);
      case "approval.request":
        if (Date.now() - authedAt.current > BACKLOG_WINDOW_MS) notify("warn", `${sessionName(stateRef.current, m.sessionId)} needs your approval.`);
        return;
      case "route.result": {
        const plan = planRoute(m);
        if (plan.kind === "confirm") return setPendingConfirm(plan);
        if (plan.kind === "pickSession") {
          setView("sessions");
          return notify("info", `Which session? I heard "${plan.spoken}".`);
        }
        if (plan.kind === "local") return plan.confirm ? setPendingConfirm(plan) : runLocal(plan.action);
        return;
      }
      default:
        return;
    }
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;
  const forgetRef = useRef(onForget);
  forgetRef.current = onForget;

  useEffect(() => {
    const c = new Connection(device.deviceToken, {
      onMessage: (m) => {
        dispatch({ type: "msg", msg: m });
        handleRef.current(m);
      },
      onStatus: (conn) => dispatch({ type: "conn", conn }),
      onAuthRejected: () => forgetRef.current(),
    });
    connRef.current = c;
    c.start();
    return () => {
      c.stop();
      connRef.current = null;
    };
  }, [device.deviceToken]);

  // Any tap counts as the gesture iOS needs before automatic speech.
  useEffect(() => {
    const onTap = () => {
      tapped.current = true;
    };
    window.addEventListener("pointerdown", onTap, { once: true });
    return () => window.removeEventListener("pointerdown", onTap);
  }, []);

  useEffect(() => {
    if (!state.toasts.length) return;
    const t = state.toasts[0]!;
    const timer = setTimeout(() => dispatch({ type: "dismissToast", id: t.id }), TOAST_MS);
    return () => clearTimeout(timer);
  }, [state.toasts]);

  const answerConfirm = (accept: boolean) => {
    const p = pendingConfirm;
    setPendingConfirm(null);
    if (!p) return;
    send({ type: "route.confirm", routeId: p.routeId, accept });
    if (accept && p.kind === "local") runLocal(p.action);
  };

  const active = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;

  return (
    <div className="app">
      <TopBar state={state} active={active} />
      <main className="main">
        {view === "talk" && (
          <TalkView
            state={state}
            active={active}
            send={send}
            player={player}
            banner={banner}
            onBanner={(play) => {
              if (play && banner) player.play(banner, sessionName(state, banner.sessionId));
              setBanner(null);
            }}
            onApprovalSent={(requestId) => dispatch({ type: "approvalSent", requestId })}
            onCopyPhone={(a) => void copyOnPhone(a)}
          />
        )}
        {view === "sessions" && <SessionsView state={state} send={send} />}
        {view === "settings" && <SettingsView settings={settings} onChange={setSettings} player={player} device={device} state={state} onForget={onForget} />}
      </main>
      <footer className="dock">
        {player.now && <NowPlayingBar now={player.now} player={player} />}
        {view === "talk" && active && !active.unlisted && <Composer state={state} active={active} send={send} />}
        <BottomNav view={view} onView={setView} approvals={state.approvals.length} />
      </footer>
      <audio ref={player.audioRef} preload="none" playsInline />
      {pendingConfirm && <ConfirmSheet echo={pendingConfirm.echo} onAnswer={answerConfirm} />}
      <Toasts toasts={state.toasts} onDismiss={(id) => dispatch({ type: "dismissToast", id })} />
    </div>
  );
}
