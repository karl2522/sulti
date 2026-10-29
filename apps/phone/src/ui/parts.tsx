import type { SessionInfo } from "@sulti/core";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { initials, type SessionView, type Tone } from "../present.js";
import type { Toast } from "../state.js";
import { back } from "../router.js";
import { Bars, Icon, Spinner } from "./icons.js";

/** Position in a staggered entrance (read by the .stagger animation delay). */
export const nth = (i: number) => ({ "--i": Math.min(i, 8) }) as CSSProperties;

/** Re-render every `ms` while `active` (for live timers only). */
export function useNow(ms: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms, active]);
  return now;
}

export function PageHeader({ title, subtitle, mono, actions, onBack = () => back() }: { title: string; subtitle?: string; mono?: boolean; actions?: ReactNode; onBack?: () => void }) {
  return (
    <header className="bar">
      <button type="button" className="icon-btn press" aria-label="Back" onClick={onBack}>
        <Icon name="back" size={22} stroke={2.2} />
      </button>
      <div className="bar-title">
        <span className="bar-name">{title}</span>
        {subtitle && <span className={"bar-sub" + (mono ? " mono" : "")}>{subtitle}</span>}
      </div>
      {actions}
    </header>
  );
}

export function Avatar({ session, tone, size = "md" }: { session: SessionInfo; tone?: Tone; size?: "md" | "sm" }) {
  return (
    <span className={"avatar avatar-" + size}>
      {session.unlisted ? <Icon name="terminal" size={22} stroke={1.8} /> : initials(session.name)}
      {tone && <span key={tone} className={"dot dot-" + tone} />}
    </span>
  );
}

export function StatusIcon({ icon }: { icon: SessionView["icon"] }) {
  if (icon === "spinner") return <Spinner />;
  if (icon === "bars") return <Bars />;
  if (icon === "none") return null;
  return <Icon name={icon} size={16} stroke={2.2} />;
}

export function StatusLine({ view }: { view: SessionView }) {
  return (
    <span className={"status tone-" + view.tone}>
      <StatusIcon icon={view.icon} />
      <span>{view.label}</span>
    </span>
  );
}

/** The floating control dock at the bottom of a page. */
export function Dock({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={"dock " + className}>{children}</div>;
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="group skeleton" aria-busy="true" aria-label="Loading sessions">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="row">
          <span className="avatar avatar-md" />
          <span className="row-text">
            <span className="sk sk-title" />
            <span className="sk sk-line" />
          </span>
        </li>
      ))}
    </ul>
  );
}

const TOAST_MS = 4200;

function ToastItem({ t, onDone }: { t: Toast; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLeaving(true), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <button type="button" className={"toast toast-" + t.level + (leaving ? " leaving" : "")} onClick={() => setLeaving(true)} onTransitionEnd={() => leaving && onDone()}>
      {t.level !== "info" && <Icon name="alert" size={18} />}
      <span>{t.message}</span>
    </button>
  );
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} onDone={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}
