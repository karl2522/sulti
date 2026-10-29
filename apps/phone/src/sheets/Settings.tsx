import { APP_VERSION } from "@sulti/core";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../appContext.js";
import type { Settings } from "../storage.js";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function Segmented<T extends string | number>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onPick(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="fine">{hint}</span>}
    </div>
  );
}

export function SettingsSheet() {
  const { state, device, settings, setSettings, player, forget } = useApp();
  const [armed, setArmed] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSettings({ ...settings, [k]: v });
    if (k === "rate") player.setRate(v as number);
  };
  const voices = [...player.voices].sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <div className="sheet-body settings">
      <h2 className="sheet-title">Settings</h2>
      <Field label="Voice" hint={settings.mode === "A" ? "Your phone's own voice. iOS may pause it when the screen locks." : "Your PC reads the answer into audio. Keeps playing on the lock screen and with AirPods."}>
        <Segmented label="Voice" value={settings.mode} options={[["A", "Phone voice"], ["B", "PC voice"]]} onPick={(v) => set("mode", v)} />
      </Field>
      {settings.mode === "A" && (
        <Field label="Phone voice">
          <div className="select-row">
            <select className="field" value={settings.voiceName ?? ""} onChange={(e) => set("voiceName", e.target.value || null)} aria-label="Phone voice">
              <option value="">System default</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-soft press" onClick={player.test} disabled={!player.hasSpeech}>
              Test
            </button>
          </div>
        </Field>
      )}
      <Field label="Speed">
        <Segmented label="Speed" value={settings.rate} options={SPEEDS.map((s) => [s, s + "×"] as [number, string])} onPick={(v) => set("rate", v)} />
      </Field>
      <Field label="New answers" hint="Automatic starts reading once you've tapped anything in the app.">
        <Segmented label="New answers" value={settings.autoRead === "auto" ? "auto" : "off"} options={[["off", "Wait for me"], ["auto", "Read automatically"]]} onPick={(v) => set("autoRead", v)} />
      </Field>
      <label className="toggle">
        <input type="checkbox" checked={settings.readCodeBlocks} onChange={(e) => set("readCodeBlocks", e.target.checked)} />
        <span className="toggle-track" aria-hidden="true" />
        <span>Read code blocks aloud</span>
      </label>

      <h3 className="field-label sheet-section">This phone</h3>
      <dl className="kv card info">
        <dt>Name</dt>
        <dd>{device.deviceName}</dd>
        <dt>PC</dt>
        <dd>{state.host ?? "Unknown"}</dd>
        <dt>Status</dt>
        <dd>{state.conn === "open" ? "Connected" : state.conn === "connecting" ? "Connecting…" : "Offline, retrying"}</dd>
        <dt>Companion</dt>
        <dd>{state.version ? "v" + state.version : "Unknown"}</dd>
      </dl>
      <button type="button" className={"btn btn-outline danger press" + (armed ? " armed" : "")} onClick={() => (armed ? forget() : setArmed(true))}>
        {armed ? "Tap again to forget this phone" : "Forget this phone"}
      </button>
      <p className="fine center">Sulti v{APP_VERSION}. Not affiliated with OpenAI.</p>
    </div>
  );
}
