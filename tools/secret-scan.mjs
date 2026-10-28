#!/usr/bin/env node
// Dependency-free secret scanner. Scans every tracked (and untracked but not
// ignored) file and exits non-zero on any hit. Run with `npm run scan`.
// A line can opt out of the scan with the marker comment: sulti-scan-allow
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ALLOW_MARKER = "sulti-scan-allow";
const MAX_BYTES = 2 * 1024 * 1024;

/** @type {{ name: string, re: RegExp }[]} */
export const RULES = [
  { name: "GitHub classic token", re: /ghp_[A-Za-z0-9]{20,}/ },
  { name: "GitHub fine-grained token", re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: "GitHub app/oauth token", re: /\bgh[ousr]_[A-Za-z0-9]{30,}/ },
  { name: "OpenAI-style secret key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "PEM block", re: /-----BEGIN [A-Z0-9 ]+-----/ },
  { name: "Codex auth.json content", re: /"(?:refresh_token|id_token|access_token|OPENAI_API_KEY|account_id)"\s*:\s*"[^"]{8,}"/ },
  { name: "Tailscale hostname", re: /\b[a-z0-9][a-z0-9-]*\.[a-z0-9-]+\.ts\.net\b/i },
  { name: "Windows user path", re: /\b[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}[A-Za-z0-9._-]+/ },
  { name: "macOS user path", re: /(?:^|[\s"'(=:])\/Users\/[A-Za-z0-9._-]+/ },
  { name: "Linux home path", re: /(?:^|[\s"'(=:])\/home\/[A-Za-z0-9._-]+\// },
];

const ENTROPY_MIN_LEN = 32;
const ENTROPY_THRESHOLD = 4.3;

export function shannon(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * True for long random-looking tokens that mix lower, upper and digits.
 * Requiring several digits keeps long CamelCase identifiers and import paths
 * (e.g. generated type names) from being flagged.
 */
export function isHighEntropy(token) {
  if (token.length < ENTROPY_MIN_LEN) return false;
  if (!/[a-z]/.test(token) || !/[A-Z]/.test(token) || !/[0-9]/.test(token)) return false;
  if ((token.match(/[0-9]/g) ?? []).length < 4) return false;
  return shannon(token) >= ENTROPY_THRESHOLD;
}

/** Scan one file's text. Returns a list of findings (never the secret itself). */
export function scanText(path, content) {
  const findings = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) findings.push({ path, line: i + 1, rule: rule.name });
    }
    if (/"integrity"\s*:/.test(line) || /\bsha(?:1|256|384|512)-/.test(line)) return;
    for (const token of line.match(/[A-Za-z0-9+/_=-]{32,}/g) ?? []) {
      if (isHighEntropy(token)) {
        findings.push({ path, line: i + 1, rule: "high-entropy string" });
        break;
      }
    }
  });
  return findings;
}

/** File names that must never be tracked at all. */
export const FORBIDDEN_FILES = [/(^|\/)\.env(\..*)?$/, /(^|\/)auth\.json$/, /(^|\/)secrets\.json$/, /(^|\/)devices\.json$/, /(^|\/)sessions\.json$/, /\.log$/];

function listFiles() {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

function main() {
  const files = listFiles();
  const findings = [];
  for (const file of files) {
    if (FORBIDDEN_FILES.some((re) => re.test(file))) {
      findings.push({ path: file, line: 0, rule: "forbidden file name" });
      continue;
    }
    let st;
    try {
      st = statSync(file);
    } catch {
      continue; // deleted in the working tree
    }
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    const buf = readFileSync(file);
    if (buf.includes(0)) continue; // binary
    findings.push(...scanText(file, buf.toString("utf8")));
  }
  if (findings.length) {
    for (const f of findings) console.error(`secret-scan: ${f.path}:${f.line} ${f.rule}`);
    console.error(`secret-scan: FAILED with ${findings.length} finding(s) in ${files.length} files`);
    process.exit(1);
  }
  console.log(`secret-scan: OK (${files.length} files)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
