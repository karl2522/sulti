import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

// Windows Restart Manager reports which processes have a file open, without opening or locking it.
// It runs in one hidden PowerShell that stays up, so the C# is compiled once.
const SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SultiOpenFiles {
  [StructLayout(LayoutKind.Sequential)] struct Proc { public int pid; public System.Runtime.InteropServices.ComTypes.FILETIME start; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Info { public Proc p; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string app; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string svc; public int type; public int status; public int session; [MarshalAs(UnmanagedType.Bool)] public bool restartable; }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint h, int flags, string key);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint nFiles, string[] files, uint nApps, IntPtr apps, uint nSvcs, string[] svcs);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h, out uint needed, ref uint n, [In, Out] Info[] list, ref uint reasons);
  public static bool InUse(string file, int ignorePid) {
    uint h;
    if (RmStartSession(out h, 0, Guid.NewGuid().ToString()) != 0) return false;
    try {
      if (RmRegisterResources(h, 1, new[] { file }, 0, IntPtr.Zero, 0, null) != 0) return false;
      uint needed = 0, n = 0, reasons = 0;
      if (RmGetList(h, out needed, ref n, null, ref reasons) == 0 || needed == 0) return false;
      var list = new Info[needed + 4];
      n = (uint)list.Length;
      if (RmGetList(h, out needed, ref n, list, ref reasons) != 0) return true;
      for (int i = 0; i < n; i++) if (list[i].p.pid != ignorePid) return true;
      return false;
    } finally { RmEndSession(h); }
  }
}
'@
$ignore = [int]$env:SULTI_PARENT_PID
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $paths = ConvertFrom-Json $line
  $out = foreach ($p in $paths) { if ([SultiOpenFiles]::InUse($p, $ignore)) { '1' } else { '0' } }
  [Console]::Out.WriteLine(@($out) -join '')
  [Console]::Out.Flush()
}`;

const TIMEOUT_MS = 20_000;

/** Which files some other process has open. Windows only; null when it can't tell. */
export class OpenFileProbe {
  private child: Promise<ChildProcessWithoutNullStreams | null> | null = null;
  private waiting: ((line: string | null) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly log: (msg: string) => void = () => {}) {}

  static supported(): boolean {
    return process.platform === "win32";
  }

  check(paths: string[]): Promise<Set<string> | null> {
    const run = this.queue.then(() => this.ask(paths));
    this.queue = run.catch(() => {});
    return run;
  }

  stop(): void {
    void this.child?.then((c) => c?.kill());
    this.child = null;
  }

  private async ask(paths: string[]): Promise<Set<string> | null> {
    if (!paths.length) return new Set();
    const child = await (this.child ??= this.spawn());
    if (!child) return null;
    const line = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.log("open-file check timed out; restarting it");
        this.stop();
        resolve(null);
      }, TIMEOUT_MS);
      this.waiting = (l) => (clearTimeout(timer), resolve(l));
      child.stdin.write(JSON.stringify(paths) + "\n");
    });
    this.waiting = null;
    if (line === null || line.length !== paths.length) return null;
    return new Set(paths.filter((_, i) => line[i] === "1"));
  }

  /** Starts the helper and resolves once it is ready to answer, or with null if it can't start. */
  private spawn(): Promise<ChildProcessWithoutNullStreams | null> {
    return new Promise((resolve) => {
      const ps = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const child = spawn(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(SCRIPT, "utf16le").toString("base64")], {
        windowsHide: true,
        env: { ...process.env, SULTI_PARENT_PID: String(process.pid) },
      });
      let ready = false;
      const fail = (why: string) => {
        clearTimeout(startup);
        if (!ready) this.log(`open-file check unavailable: ${why}`);
        this.child = null;
        this.waiting?.(null);
        resolve(null);
      };
      const startup = setTimeout(() => (child.kill(), fail("no answer after 30 s")), 30_000);
      createInterface({ input: child.stdout }).on("line", (l) => {
        if (ready) return this.waiting?.(l.trim());
        if (l.trim() !== "ready") return;
        ready = true;
        clearTimeout(startup);
        resolve(child);
      });
      child.stdin.on("error", () => {});
      child.on("error", (err) => fail(err.message));
      child.on("exit", (code) => fail(`exited with ${code}`));
    });
  }
}
