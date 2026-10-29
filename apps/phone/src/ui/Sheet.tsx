import { createContext, useCallback, useContext, useEffect, useRef, type PointerEvent as RPointerEvent, type ReactNode } from "react";

const CloseCtx = createContext<() => void>(() => {});
/** Inside a sheet: close it with its exit animation. */
export const useSheetClose = () => useContext(CloseCtx);

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Past the top edge the sheet follows less and less (a soft wall, not a hard stop). */
const rubberband = (over: number, size: number) => (over * size * 0.55) / (size + 0.55 * Math.abs(over));

/**
 * Bottom sheet. Enters from the bottom (CSS @starting-style), leaves the same
 * way, and can be dragged down from its top edge: it tracks the finger 1:1,
 * and dismisses on distance or on a flick, finishing at the flick's speed.
 */
export function Sheet({ label, onClose, children, tone }: { label: string; onClose: () => void; children: ReactNode; tone?: "plain" }) {
  const layer = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const closing = useRef(false);
  const drag = useRef<{ id: number; y0: number; dy: number; samples: [number, number][] } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback((velocity = 0) => {
    const el = sheet.current;
    if (!el || closing.current) return;
    closing.current = true;
    if (reduceMotion()) return onCloseRef.current();
    const remaining = el.offsetHeight - (drag.current?.dy ?? 0);
    // Leave at the flick's speed when there was one, else the standard exit.
    const ms = velocity > 0.3 ? Math.max(120, Math.min(320, remaining / velocity)) : 260;
    el.style.transition = "transform " + ms + "ms var(--ease-out)";
    el.style.transform = "translateY(100%)";
    layer.current?.setAttribute("data-closing", "");
    window.setTimeout(() => onCloseRef.current(), ms);
  }, []);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    sheet.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [close]);

  const onDown = (e: RPointerEvent) => {
    if (closing.current || e.button !== 0 || drag.current) return; // one finger at a time
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, y0: e.clientY, dy: 0, samples: [[e.timeStamp, e.clientY]] };
    if (sheet.current) sheet.current.style.transition = "none";
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    const el = sheet.current;
    if (!d || d.id !== e.pointerId || !el) return;
    const raw = e.clientY - d.y0;
    d.dy = raw >= 0 ? raw : rubberband(raw, el.offsetHeight);
    d.samples = [...d.samples.filter(([t]) => e.timeStamp - t < 100), [e.timeStamp, e.clientY]];
    el.style.transform = "translateY(" + d.dy + "px)";
    layer.current?.style.setProperty("--scrim", String(Math.max(0, 1 - Math.max(0, d.dy) / el.offsetHeight)));
  };
  const onUp = (e: RPointerEvent) => {
    const d = drag.current;
    const el = sheet.current;
    if (!d || d.id !== e.pointerId || !el) return;
    const [t0, y0] = d.samples[0]!;
    const velocity = (e.clientY - y0) / Math.max(1, e.timeStamp - t0); // px per ms, + is down
    if (d.dy > el.offsetHeight * 0.3 || velocity > 0.5) return close(velocity);
    drag.current = null;
    el.style.transition = "transform 320ms var(--ease-drawer)";
    el.style.transform = "";
    layer.current?.style.removeProperty("--scrim");
  };

  return (
    <CloseCtx.Provider value={close}>
      <div className="sheet-layer" ref={layer}>
        <div className="scrim" onClick={() => close()} />
        <section ref={sheet} className={"sheet" + (tone === "plain" ? " sheet-plain" : "")} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
          <div className="sheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <span className="sheet-handle" />
          </div>
          {children}
        </section>
      </div>
    </CloseCtx.Provider>
  );
}

