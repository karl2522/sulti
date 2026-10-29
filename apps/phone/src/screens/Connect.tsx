import { useState, type FormEvent } from "react";
import { pairDevice, pairingCodeFromHash } from "../pair.js";
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

export function Connect({ onPaired }: { onPaired: (d: Device) => void }) {
  const fromLink = pairingCodeFromHash(location.hash);
  const [code, setCode] = useState(fromLink ?? "");
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.replace(/[\s-]/g, "").toUpperCase();
    if (!/^[A-Z0-9]{6,32}$/.test(c)) return setError("That code doesn't look right. Check the code on your PC.");
    setPhase("busy");
    setError(null);
    try {
      const d = await pairDevice(c, deviceName());
      setPhase("done");
      window.setTimeout(() => onPaired(d), 420); // let the check mark land
    } catch (err) {
      setPhase("idle");
      setError((err as Error).message);
    }
  };

  return (
    <form className="page page-none connect" onSubmit={submit}>
      <header className="bar bar-home">
        <Logo />
      </header>
      <div className="scroll">
        <h1 className="title">Connect this phone</h1>
        <p className="lead">{fromLink ? "Check that this code matches the one on your PC." : "Open the pairing link from your PC, or type the code it shows."}</p>
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
          {fromLink ? (
            <div className="code-box mono" aria-label={"Pairing code " + code.split("").join(" ")}>
              {pretty(code)}
            </div>
          ) : (
            <input className="code-box mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Pairing code" aria-label="Pairing code" autoCapitalize="characters" autoComplete="one-time-code" spellCheck={false} maxLength={40} autoFocus />
          )}
        </section>
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
        <button className={"btn btn-primary btn-lg press connect-btn" + (phase === "done" ? " is-done" : "")} disabled={phase !== "idle" || !code.trim()}>
          {phase === "busy" ? <Spinner size={20} /> : phase === "done" ? <Icon name="check" size={22} stroke={2.6} /> : "Connect"}
        </button>
      </div>
    </form>
  );
}

