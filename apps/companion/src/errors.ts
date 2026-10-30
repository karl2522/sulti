/** Map Codex errors to short sentences that sound fine when read aloud. */
export function speakableError(info: unknown, message?: string | null): string {
  const key = typeof info === "string" ? info : info && typeof info === "object" ? Object.keys(info)[0] : undefined;
  switch (key) {
    case "usageLimitExceeded":
      return "Codex hit its usage limit. Try again later.";
    case "sessionBudgetExceeded":
      return "This session ran out of its budget.";
    case "rateLimitExceeded":
      return "Codex is rate limited right now. Try again in a minute.";
    case "contextWindowExceeded":
      return "This chat is too long for the model. Start a new one with /new.";
    case "serverOverloaded":
      return "Codex servers are busy. Try again shortly.";
    case "unauthorized":
      return "Codex is signed out on the PC.";
    case "sandboxError":
      return "The sandbox blocked that action.";
    case "httpConnectionFailed":
    case "responseStreamConnectionFailed":
    case "responseStreamDisconnected":
    case "responseTooManyFailedAttempts":
      return "Codex lost its connection. Try again.";
    case "modelNotFound":
      return "The configured model isn't available.";
    default: {
      const first = (message ?? "").split(/(?<=[.!?])\s/)[0]?.trim();
      return first && first.length <= 140 ? `The turn failed: ${first}` : "The turn failed.";
    }
  }
}

export const APP_SERVER_DOWN = "Codex isn't responding on the PC. Restarting it.";
