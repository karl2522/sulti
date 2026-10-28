import { spawn } from "node:child_process";
import { resolveExecutable } from "./spawn.js";

/** Read-only: the HTTPS URL of this PC on the tailnet, from "tailscale status --json". */
export function detectTailscaleUrl(timeoutMs = 3000): Promise<string | null> {
  const exe = resolveExecutable("tailscale");
  if (!exe || exe.kind === "cmd") return Promise.resolve(null);
  return new Promise((resolve) => {
    const child = spawn(exe.file, ["status", "--json"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const t = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => {
      clearTimeout(t);
      resolve(null);
    });
    child.on("exit", () => {
      clearTimeout(t);
      resolve(parseTailscaleStatus(out));
    });
  });
}

export function parseTailscaleStatus(json: string): string | null {
  try {
    const name = (JSON.parse(json) as { Self?: { DNSName?: string } }).Self?.DNSName;
    return name ? "https://" + name.replace(/\.$/, "") : null;
  } catch {
    return null;
  }
}
