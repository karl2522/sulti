import { useEffect, useState } from "react";

/**
 * A tiny history router. Paths: "/", "/s/:id", "/a/:id", "/talk?to=&skill=".
 * Each history entry carries its depth, so a pop knows it went back and the
 * page can slide in from the matching side.
 */
export type Direction = "forward" | "back" | "none";

export interface Route {
  path: string;
  query: URLSearchParams;
  direction: Direction;
  /** Changes on every navigation, to remount and replay the page entrance. */
  key: number;
}

let depth = typeof history !== "undefined" ? ((history.state as { depth?: number } | null)?.depth ?? 0) : 0;
let seq = 0;
const listeners = new Set<(r: Route) => void>();

function current(direction: Direction): Route {
  return { path: location.pathname, query: new URLSearchParams(location.search), direction, key: ++seq };
}

function emit(direction: Direction): void {
  const r = current(direction);
  for (const l of listeners) l(r);
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === location.pathname + location.search) return;
  if (opts.replace) history.replaceState({ depth }, "", to);
  else history.pushState({ depth: ++depth }, "", to);
  emit(opts.replace ? "none" : "forward");
}

/** Go back if there is somewhere to go back to inside the app, else replace with the fallback. */
export function back(fallback = "/"): void {
  if (depth > 0) history.back();
  else navigate(fallback, { replace: true });
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", (e) => {
    const next = (e.state as { depth?: number } | null)?.depth ?? 0;
    const direction: Direction = next < depth ? "back" : "forward";
    depth = next;
    emit(direction);
  });
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => current("none"));
  useEffect(() => {
    listeners.add(setRoute);
    return () => void listeners.delete(setRoute);
  }, []);
  return route;
}

/** "/s/abc" with pattern "/s/" gives "abc". */
export function param(path: string, prefix: string): string | null {
  return path.startsWith(prefix) && path.length > prefix.length ? decodeURIComponent(path.slice(prefix.length)) : null;
}

