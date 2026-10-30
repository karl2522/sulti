import type { ReactNode } from "react";

/** Icons from the Sulti design (24px grid, round strokes in currentColor). */
const PATHS = {
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  shield: <path d="M12 3.5l7 2.5v5.6c0 4.3-2.9 7.8-7 9.4-4.1-1.6-7-5.1-7-9.4V6zM12 8.5v4.2M12 16.2v.3" />,
  terminal: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4" />
    </>
  ),
  speaker: <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3zM16 9a4 4 0 0 1 0 6" />,
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" strokeWidth="1.5" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  code: <path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5" />,
  restart: <path d="M8.5 5.94A7 7 0 1 0 15.5 5.94M16.6 9L15.5 5.94L18.7 5.4" />,
  prev: (
    <>
      <path d="M6.5 6v12" />
      <path d="M18 6.5v11L9.5 12z" fill="currentColor" />
    </>
  ),
  next: (
    <>
      <path d="M17.5 6v12" />
      <path d="M6 6.5v11l8.5-5.5z" fill="currentColor" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />,
  monitor: <path d="M6.1 5h11.8c.9 0 1.6.7 1.6 1.6v6.8c0 .9-.7 1.6-1.6 1.6H6.1c-.9 0-1.6-.7-1.6-1.6V6.6c0-.9.7-1.6 1.6-1.6zM2.5 19h19" />,
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="10" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  file: <path d="M7 3.5h6.5L18 8v12.5H7zM13.5 3.5V8H18" />,
  pencil: <path d="M4.5 19.5l1-4.5L15.5 5l3.5 3.5-10 10zM13.5 7l3.5 3.5" />,
  flag: <path d="M6 20.5V4M6 4.5h10.5l-2 4 2 4H6" />,
  search: <path d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.8-4.8" />,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  addHome: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chat: <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-9l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V6.5A1.5 1.5 0 0 1 5 5z" />,
  alert: <path d="M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 8v5M12 16v.4" />,
  dots: (
    <>
      <circle cx="5.5" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, stroke = 2 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/** Spinning ring for "working". */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="icon spinner" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" strokeOpacity="0.35" />
      <path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5" />
    </svg>
  );
}

/** Five bars that move while something is being read aloud. */
export function Bars({ size = 16, live = true }: { size?: number; live?: boolean }) {
  const bars: [number, number][] = [[4, 2], [8, 5], [12, 2.5], [16, 6], [20, 2]];
  return (
    <svg className={"icon bars" + (live ? " live" : "")} width={size} height={size} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      {bars.map(([x, h]) => (
        <line key={x} x1={x} x2={x} y1={12 - h} y2={12 + h} />
      ))}
    </svg>
  );
}

/** The Sulti mark: two arcs, two voices. */
export function Mark({ height = 27 }: { height?: number }) {
  return (
    <svg className="mark" width={(height * 28) / 42} height={height} viewBox="18 11 28 42" fill="none" strokeWidth="6" strokeLinecap="round" aria-hidden="true">
      <path className="mark-a" d="M40.08 21.6A8.6 7.75 0 1 0 27.07 30.6" stroke="var(--accent)" pathLength={1} />
      <path className="mark-b" d="M36.93 33.4A8.6 7.75 0 1 1 23.92 42.4" stroke="var(--text)" pathLength={1} />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <Mark />
      <span className="logo-word">sulti</span>
    </span>
  );
}
