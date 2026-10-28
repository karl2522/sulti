#!/usr/bin/env node
// Regenerates version-matched app-server types from the installed Codex CLI:
//   codex app-server generate-ts --out packages/protocol/src/generated
// then rewrites relative imports to explicit ".js" paths so the output
// compiles under NodeNext module resolution, and records the Codex version.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(pkgDir, "src", "generated");

function codex(args) {
  // npm installs codex as a .cmd shim on Windows, which needs a shell.
  const res = spawnSync("codex", args, { encoding: "utf8", shell: process.platform === "win32" });
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout);
    process.exit(res.status ?? 1);
  }
  return res.stdout.trim();
}

const version = codex(["--version"]).replace(/^codex-cli\s*/, "");
// Only ever delete the generated folder inside this package.
if (existsSync(outDir) && outDir.startsWith(pkgDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
codex(["app-server", "generate-ts", "--out", outDir]);

let rewritten = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) {
      walk(file);
      continue;
    }
    if (!name.endsWith(".ts")) continue;
    const src = readFileSync(file, "utf8");
    const out = src.replace(/(from\s+")(\.{1,2}\/[^"]+)(")/g, (_m, a, spec, b) => {
      if (spec.endsWith(".js")) return a + spec + b;
      const target = resolve(dirname(file), spec);
      const isDir = existsSync(target) && statSync(target).isDirectory();
      return a + spec + (isDir ? "/index.js" : ".js") + b;
    });
    if (out !== src) {
      writeFileSync(file, out);
      rewritten++;
    }
  }
}
walk(outDir);
writeFileSync(join(pkgDir, "CODEX_VERSION"), version + "\n");
console.log(`generated app-server types for codex ${version}; rewrote imports in ${rewritten} files`);
