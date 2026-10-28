import { randomBytes } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { psLiteral, runPowerShell } from "./powershell.js";

/** "Copy to PC": write a temp file and pipe it into Set-Clipboard. */
export async function copyToPcClipboard(text: string): Promise<void> {
  const file = join(tmpdir(), `sulti-clip-${randomBytes(6).toString("hex")}.txt`);
  writeFileSync(file, text, "utf8");
  try {
    const res = await runPowerShell(["-Command", `Get-Content -Raw -Encoding UTF8 -LiteralPath ${psLiteral(file)} | Set-Clipboard`], 15_000);
    if (res.code !== 0) throw new Error("Set-Clipboard failed");
  } finally {
    rmSync(file, { force: true });
  }
}
