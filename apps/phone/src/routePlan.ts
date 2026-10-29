import type { AppIntent, CompanionMessageOf } from "@sulti/core";

export type AppAction = AppIntent["action"];
export type RouteResult = CompanionMessageOf<"route.result">;

/**
 * What the phone must do with a `route.result` from the companion.
 *
 * - "done": the companion already ran it (Codex and prompt intents, and session
 *   switches it could resolve, when no confirmation was needed).
 * - "confirm": show the confirm sheet, then send `route.confirm`; the companion runs it.
 * - "pickSession": the router heard "switch" but no session matched; show the
 *   picker and send `session.select`. No `route.confirm` (the hub kept nothing).
 * - "local": an app action the phone runs itself (playback, copy, approvals).
 *   When `confirm` is set, ask first and also send `route.confirm` either way.
 */
export type RoutePlan =
  | { kind: "done"; echo: string }
  | { kind: "confirm"; routeId: string; echo: string }
  | { kind: "pickSession"; echo: string; spoken: string }
  | { kind: "local"; routeId: string; echo: string; action: Exclude<AppAction, { type: "switchSession" }>; confirm: boolean };

export function planRoute(r: RouteResult): RoutePlan {
  const { intent, routeId, echo, needsConfirm } = r;
  if (intent.kind !== "app") return needsConfirm ? { kind: "confirm", routeId, echo } : { kind: "done", echo };
  const action = intent.action;
  if (action.type === "switchSession") {
    if (!action.sessionId) return { kind: "pickSession", echo, spoken: action.spoken };
    return needsConfirm ? { kind: "confirm", routeId, echo } : { kind: "done", echo };
  }
  return { kind: "local", routeId, echo, action, confirm: needsConfirm };
}
