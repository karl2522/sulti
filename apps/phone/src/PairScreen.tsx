import { useState, type FormEvent } from "react";
import { pairDevice, pairingCodeFromHash } from "./pair.js";
import type { Device } from "./storage.js";

function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  return "Browser";
}

export function PairScreen({ onPaired }: { onPaired: (d: Device) => void }) {
  const [code, setCode] = useState(() => pairingCodeFromHash(location.hash) ?? "");
  const [name, setName] = useState(guessDeviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,32}$/.test(c)) return setError("That code doesn't look right. Check the pairing link on your PC.");
    setBusy(true);
    setError(null);
    try {
      onPaired(await pairDevice(c, name.trim() || "Phone"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="center-screen">
      <img src="/icon.svg" alt="" width={72} height={72} />
      <h1>Pair this phone</h1>
      <p className="muted">Pairing lets this phone talk to the Sulti companion on your PC. Codes work once and expire after 10 minutes.</p>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Pairing code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="one-time-code" spellCheck={false} />
        </label>
        <label className="field">
          <span>Name for this device</span>
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary big" disabled={busy}>
          {busy ? "Pairing…" : "Pair"}
        </button>
      </form>
    </main>
  );
}

export function Unpaired() {
  return (
    <main className="center-screen">
      <img src="/icon.svg" alt="" width={72} height={72} />
      <h1>Not paired yet</h1>
      <p className="muted">
        Start the Sulti companion on your PC and open the pairing link it prints on this phone. Press Enter in the companion window for a new link, or run <code>npm run pair</code>.
      </p>
      <a className="btn big" href="/pair">
        I have a code
      </a>
    </main>
  );
}
