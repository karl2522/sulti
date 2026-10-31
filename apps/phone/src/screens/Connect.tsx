import { useEffect, useState, type FormEvent } from "react";
import { askToPair, pairDevice, pairingCodeFromHash, pollPair, type PairAsk } from "../pair.js";
import type { Device } from "../storage.js";
import { Icon, Logo, Spinner } from "../ui/icons.js";
import { nth } from "../ui/parts.js";

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  return "Browser";
}

const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
/** "ABCDE12345" reads as "ABCDE-12345". */
const pretty = (c: string) => (c.length > 6 ? c.slice(0, Math.ceil(c.length / 2)) + "-" + c.slice(Math.ceil(c.length / 2)) : c);
const POLL_MS = 1500;

export function Connect({ onPaired }: { onPaired: (d: Device) => void }) {
  const fromLink = pairingCodeFromHash(location.hash);
  const [useCode, setUseCode] = useState(!!fromLink);
  const [code, setCode] = useState(fromLink ?? "");
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const [ask, setAsk] = useState<PairAsk | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = (d: Device) => {
    setPhase("done");
    window.setTimeout(() => onPaired(d), 420); // let the check mark land
  };
  const fail = (message: string) => {
    setPhase("idle");
    setAsk(null);
    setError(message);
  };

  // Waiting for a tap on a phone that's already connected.
  useEffect(() => {
    if (!ask) return;
    let stopped = false;
    const t = window.setInterval(async () => {
      const r = await pollPair(ask).catch(() => null); // a network blip: try again next tick
      if (stopped || !r) return;
      if (r.status === "approved") return (stopped = true), finish({ deviceId: r.deviceId, deviceToken: r.deviceToken, deviceName: deviceName(), pairedAt: Date.now() });
      if (r.status !== "pending") {
        stopped = true;
        fail(r.status === "denied" ? "Your other phone said no." : "No one allowed it in time. Try again, or use a code from your PC.");
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!useCode) {
      setPhase("busy");
      setError(null);
      try {
        setAsk(await askToPair(deviceName()));
      } catch (err) {
        fail((err as Error).message);
      }
      return;
    }
    const c = code.replace(/[\s-]/g, "").toUpperCase();
    if (!/^[A-Z0-9]{6,32}$/.test(c)) return setError("That code doesn't look right. Check the code on your PC.");
    setPhase("busy");
    setError(null);
    try {
      finish(await pairDevice(c, deviceName()));
    } catch (err) {
      fail((err as Error).message);
    }
  };

  const cancel = () => {
    if (ask) void pollPair(ask, true).catch(() => {});
    setAsk(null);
    setPhase("idle");
  };
  const switchTo = (code: boolean) => {
    setUseCode(code);
    setError(null);
  };

  const lead = useCode
    ? fromLink
      ? "Check that this code matches the one on your PC."
      : "Type the code from the Sulti pairing page on your PC."
    : ask
      ? "On your connected phone, tap Allow when it shows " + ask.match + "."
      : "Ask a phone that's already connected to let this one in.";

  return (
    <form className="page page-none connect" onSubmit={submit}>
      <header className="bar bar-home">
        <Logo />
      </header>
      <div className="scroll">
        <h1 className="title">Connect this phone</h1>
        <p className="lead">{lead}</p>
        <section className="card pc-card stagger" style={nth(0)}>
          <div className="pc-row">
            <span className="tile">
              <Icon name="monitor" size={20} stroke={1.9} />
            </span>
            <span className="pc-text">
              <strong>Your PC</strong>
              <span>Runs the Sulti companion</span>
            </span>
          </div>
          {useCode ? (
            fromLink ? (
              <div className="code-box mono" aria-label={"Pairing code " + code.split("").join(" ")}>
                {pretty(code)}
              </div>
            ) : (
              <input className="code-box mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Pairing code" aria-label="Pairing code" autoCapitalize="characters" autoComplete="one-time-code" spellCheck={false} maxLength={40} autoFocus />
            )
          ) : ask ? (
            <div className="code-box mono" aria-label={"Match code " + ask.match}>
              {ask.match}
            </div>
          ) : null}
        </section>
        {!useCode && ask && !ask.asked && (
          <p className="note" role="status">
            <Icon name="alert" size={16} />
            <span>Sulti isn't open on your other phone right now. Open it there and it will ask you.</span>
          </p>
        )}
        {!useCode && !ask && (
          <p className="note stagger" style={nth(1)}>
            <Icon name="monitor" size={16} />
            <span>First phone? Open the Sulti pairing shortcut on your PC and scan its QR code with the Camera.</span>
          </p>
        )}
        <p className="note stagger" style={nth(1)}>
          <Icon name="shield" size={16} />
          <span>Sulti connects straight to your PC. Nothing passes through a Sulti server.</span>
        </p>
        {!standalone() && (
          <section className="card tip stagger" style={nth(2)}>
            <span className="tile tile-accent">
              <Icon name="addHome" size={18} />
            </span>
            <div>
              <strong>Next, add Sulti to your Home Screen</strong>
              <p>It opens full screen, without Safari's bars, like any other app on your phone.</p>
            </div>
          </section>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className={"btn btn-primary btn-lg press connect-btn" + (phase === "done" ? " is-done" : "")} disabled={phase !== "idle" || (useCode && !code.trim())}>
          {phase === "done" ? <Icon name="check" size={22} stroke={2.6} /> : phase === "busy" ? <Spinner size={20} /> : useCode ? "Connect" : "Ask to connect"}
        </button>
        {ask ? (
          <button type="button" className="link-btn press" onClick={cancel}>
            Cancel
          </button>
        ) : (
          !fromLink && (
            <button type="button" className="link-btn press" onClick={() => switchTo(!useCode)} disabled={phase !== "idle"}>
              {useCode ? "Ask a connected phone instead" : "Have a pairing code?"}
            </button>
          )
        )}
      </div>
    </form>
  );
}
