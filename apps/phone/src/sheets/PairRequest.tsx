import { useEffect, useState } from "react";
import { useApp } from "../appContext.js";
import { Icon } from "../ui/icons.js";
import { useSheetClose } from "../ui/Sheet.js";

const country = (code: string | null) => {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** "An iPhone wants to connect": only a tap here lets a new device in. */
export function PairRequestSheet({ requestId }: { requestId: string }) {
  const { state, send } = useApp();
  const close = useSheetClose();
  const r = state.pairRequests.find((x) => x.requestId === requestId);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const gone = !r || r.expiresAt <= now;
  // Answered on another phone, cancelled, or timed out.
  useEffect(() => {
    if (gone) close();
  }, [gone, close]);
  if (gone) return null;

  const respond = (accept: boolean) => {
    if (send({ type: "pair.respond", requestId: r.requestId, accept })) close();
  };
  const where = country(r.place);

  return (
    <div className="sheet-body approval">
      <div className="approval-head">
        <span className="tile tile-coral">
          <Icon name="lock" size={24} stroke={1.9} />
        </span>
        <div>
          <h2 className="sheet-title">Let a new {r.deviceName} connect?</h2>
          <p className="muted">{where ? "Asking from " + where : "Asking to use Sulti"}</p>
        </div>
      </div>
      <div className="code-box mono" aria-label={"Match code " + r.match}>
        {r.match}
      </div>
      <p className="muted center">Allow only if the new device shows {r.match} and it's yours. It gets full access to your sessions.</p>
      <div className="approval-actions">
        <button type="button" className="btn btn-outline btn-lg press" onClick={() => respond(false)}>
          Deny
        </button>
        <button type="button" className="btn btn-primary btn-lg press" onClick={() => respond(true)}>
          Allow
        </button>
      </div>
    </div>
  );
}
