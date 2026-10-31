import type { Answer, CompanionMessage, PhoneMessage } from "@sulti/core";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Ctx, type AppCtx, type SheetSpec } from "./appContext.js";
import { Connection } from "./connection.js";
import { planRoute, type AppAction } from "./routePlan.js";
import { navigate, param, useRoute } from "./router.js";
import { Connect } from "./screens/Connect.js";
import { Listen } from "./screens/Listen.js";
import { SessionDetail } from "./screens/SessionDetail.js";
import { Sessions } from "./screens/Sessions.js";
import { Talk } from "./screens/Talk.js";
import { SheetHost } from "./sheets/SheetHost.js";
import { initialState, reducer, sessionName, type ToastLevel } from "./state.js";
import { forgetDevice, isFreshDevice, loadDevice, loadHeard, loadSettings, saveDevice, saveHeard, saveSettings, type Device, type Settings } from "./storage.js";
import { Toasts } from "./ui/parts.js";
import { usePlayer } from "./usePlayer.js";

export function App() {
  const [device, setDevice] = useState<Device | null>(loadDevice);
  // A paired phone opening an old pairing link just goes to the app.
  if (device && location.pathname === "/pair") history.replaceState({ depth: 0 }, "", "/");
  if (!device) {
    return (
      <Connect
        onPaired={(d) => {
          saveDevice(d);
          history.replaceState({ depth: 0 }, "", "/");
          setDevice(d);
        }}
      />
    );
  }
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

/** Answers that arrive this soon after auth are the companion's backlog, not new. */
const BACKLOG_MS = 1500;

function Main({ device, onForget }: { device: Device; onForget: () => void }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [sheet, setSheet] = useState<SheetSpec | null>(null);
  const [heard, setHeard] = useState(loadHeard);
  const route = useRoute();
  const connRef = useRef<Connection | null>(null);
  const authedAt = useRef(0);
  const seen = useRef(new Set<string>());
  const tapped = useRef(false);
  // A newly paired phone shouldn't greet you with every old answer as "ready".
  const fresh = useRef(isFreshDevice());
  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const pathRef = useRef(route.path);
  pathRef.current = route.path;

  const notify = useCallback((level: ToastLevel, message: string) => dispatch({ type: "toast", level, message }), []);
  const send = useCallback(
    (m: PhoneMessage) => {
      const ok = connRef.current?.send(m) ?? false;
      if (!ok) notify("warn", "Not connected to your PC right now.");
      return ok;
    },
    [notify],
  );
  const player = usePlayer(settings, send, notify);
  const setSettings = useCallback((s: Settings) => {
    saveSettings(s);
    setSettingsState(s);
  }, []);
  const markHeard = useCallback(
    (id: string) =>
      setHeard((h) => {
        if (h.has(id)) return h;
        const next = new Set(h).add(id);
        saveHeard(next);
        return next;
      }),
    [],
  );
  const listen = useCallback(
    (a: Answer, fromUnit?: number) => {
      markHeard(a.id);
      player.play(a, sessionName(stateRef.current, a.sessionId), fromUnit);
    },
    [markHeard, player],
  );
  const copyOnPhone = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(
        () => notify("info", "Copied."),
        () => notify("warn", "Your phone blocked copying. Try again from the copy button."),
      );
    },
    [notify],
  );
  const openSheet = useCallback((s: SheetSpec) => setSheet(s), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  // A new device asking to connect takes the next free sheet, once; someone is waiting on it.
  const askedPair = useRef(new Set<string>());
  useEffect(() => {
    const r = state.pairRequests.find((x) => !askedPair.current.has(x.requestId) && x.expiresAt > Date.now());
    if (sheet || !r) return;
    askedPair.current.add(r.requestId);
    setSheet({ kind: "pairRequest", requestId: r.requestId });
  }, [sheet, state.pairRequests]);

  // Voice commands that act on the phone itself.
  const runLocal = (action: Exclude<AppAction, { type: "switchSession" }>) => {
    const s = stateRef.current;
    const latest = s.answers.find((a) => a.sessionId === s.activeSessionId) ?? s.answers[0];
    if (action.type === "showApprovals") return s.approvals.length ? openSheet({ kind: "approval" }) : notify("info", "Nothing is waiting for approval.");
    if (!latest) return notify("info", "No answers yet.");
    if (action.type === "copy") {
      if (action.target === "phone") return copyOnPhone(latest.text);
      if (action.target === "pc") return void send({ type: "answer.copyToPc", answerId: latest.id });
      return openSheet({ kind: "copy", answer: latest });
    }
    const p = action.playback;
    if (p === "pause") return player.pause();
    if (p === "resume") return player.resume();
    if (p === "stop") return player.stop();
    if ((p === "again" || p === "restart") && player.now) return player.restart();
    listen(latest);
  };

  const handle = (m: CompanionMessage) => {
    const backlog = Date.now() - authedAt.current < BACKLOG_MS;
    switch (m.type) {
      case "auth.ok":
        authedAt.current = Date.now();
        return;
      case "answer": {
        const { type: _t, ...a } = m;
        if (seen.current.has(a.id)) return;
        seen.current.add(a.id);
        if (backlog) return void (fresh.current && markHeard(a.id));
        player.prefetch(a);
        if (settingsRef.current.autoRead === "auto" && tapped.current) return listen(a);
        // Home and that session's own page already show it.
        const p = pathRef.current;
        if (p !== "/" && p !== "/s/" + encodeURIComponent(a.sessionId)) notify("info", sessionName(stateRef.current, a.sessionId) + " answered.");
        return;
      }
      case "audio.url":
        return player.onAudioUrl(m.answerId, m.url);
      case "audio.failed":
        return player.onAudioFailed(m.answerId, m.message);
      case "approval.request":
        if (backlog) return;
        if (!sheetRef.current) return openSheet({ kind: "approval", requestId: m.requestId });
        return notify("warn", sessionName(stateRef.current, m.sessionId) + " needs your approval.");
      case "pair.request":
        if (sheetRef.current) notify("warn", "A new " + m.deviceName + " wants to connect.");
        return;
      case "route.result": {
        const plan = planRoute(m);
        const confirm = (onAccept?: () => void) =>
          openSheet({
            kind: "confirm",
            echo: plan.echo,
            onAnswer: (accept) => {
              if ("routeId" in plan) send({ type: "route.confirm", routeId: plan.routeId, accept });
              if (accept) onAccept?.();
            },
          });
        if (plan.kind === "confirm") return confirm();
        if (plan.kind === "pickSession")
          return openSheet({ kind: "pickSession", title: "Which session? I heard “" + plan.spoken + "”", onPick: (id) => send({ type: "session.select", sessionId: id }) });
        if (plan.kind === "local") return plan.confirm ? confirm(() => runLocal(plan.action)) : runLocal(plan.action);
        if (m.intent.kind === "prompt") notify("info", "Sent to " + sessionName(stateRef.current, m.intent.sessionId) + ".");
        else if (m.intent.kind === "codex") notify("info", plan.echo);
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
    const onTap = () => void (tapped.current = true);
    window.addEventListener("pointerdown", onTap, { once: true });
    return () => window.removeEventListener("pointerdown", onTap);
  }, []);

  const ctx: AppCtx = { state, device, settings, setSettings, send, notify, player, heard, markHeard, listen, copyOnPhone, sheet, openSheet, closeSheet, forget: onForget };

  const id = (prefix: string) => param(route.path, prefix);
  let screen;
  if (route.path === "/") screen = <Sessions />;
  else if (id("/s/")) screen = <SessionDetail id={id("/s/")!} />;
  else if (id("/a/")) screen = <Listen answerId={id("/a/")!} />;
  else if (route.path === "/talk") screen = <Talk query={route.query} />;
  else {
    queueMicrotask(() => navigate("/", { replace: true }));
    screen = null;
  }
  const motion = route.path === "/talk" && route.direction === "forward" ? "up" : route.direction;

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        {state.conn === "offline" && (
          <div className="offline" role="status">
            Can't reach your PC. Retrying…
          </div>
        )}
        <div key={route.key} className={"page page-" + motion}>
          {screen}
        </div>
        <SheetHost />
        <Toasts toasts={state.toasts} onDismiss={(tid) => dispatch({ type: "dismissToast", id: tid })} />
        <audio ref={player.audioRef} preload="none" playsInline />
      </div>
    </Ctx.Provider>
  );
}
