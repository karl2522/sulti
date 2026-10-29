import type { Answer, PhoneMessage } from "@sulti/core";
import { createContext, useContext } from "react";
import type { AppState, ToastLevel } from "./state.js";
import type { Device, Settings } from "./storage.js";
import type { Player } from "./usePlayer.js";

/** The one bottom sheet that can be open at a time. */
export type SheetSpec =
  | { kind: "approval"; requestId?: string }
  | { kind: "settings" }
  | { kind: "pickSession"; title: string; onPick: (sessionId: string) => void }
  | { kind: "skills"; sessionId: string; onPick: (skill: string) => void }
  | { kind: "threads"; sessionId: string }
  | { kind: "confirm"; echo: string; onAnswer: (accept: boolean) => void }
  | { kind: "copy"; answer: Answer };

export interface AppCtx {
  state: AppState;
  device: Device;
  settings: Settings;
  setSettings: (s: Settings) => void;
  /** Returns false (and tells the user) when offline. */
  send: (m: PhoneMessage) => boolean;
  notify: (level: ToastLevel, message: string) => void;
  player: Player;
  heard: ReadonlySet<string>;
  markHeard: (answerId: string) => void;
  /** Start reading an answer aloud (and mark it heard). */
  listen: (answer: Answer, fromUnit?: number) => void;
  copyOnPhone: (text: string) => void;
  sheet: SheetSpec | null;
  openSheet: (s: SheetSpec) => void;
  closeSheet: () => void;
  forget: () => void;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside the app");
  return c;
}
