import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Windows PowerShell 5.1 (System.Speech and Set-Clipboard live there). */
export function windowsPowerShell(): string {
  const root = process.env.SystemRoot ?? "C:\\Windows";
  const p = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return existsSync(p) ? p : "powershell.exe";
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run powershell.exe hidden (no console window) with a timeout. */
export function runPowerShell(args: string[], timeoutMs = 120_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Quote a value as a PowerShell single-quoted literal. */
export function psLiteral(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}
