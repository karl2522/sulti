// Live end-to-end check before a release: real Codex and the real companion
// behind a temporary Cloudflare quick tunnel, in a throwaway data folder (your
// own sessions, devices and chats are untouched). Costs two short Codex turns.
//   npm run build && npm run e2e:live
// Needs cloudflared on PATH and the Playwright Chromium browser.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pw from "playwright-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 7617;
const shots = join("test", "live-output", "e2e-live");
mkdirSync(shots, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "sulti-live-"));
const work = join(dir, "work", "e2e-project");
mkdirSync(work, { recursive: true });
writeFileSync(join(work, "README.md"), "# E2E project\nA scratch folder for the Sulti end-to-end test.\n");
writeFileSync(join(dir, "sessions.json"), JSON.stringify({ sessions: [{ name: "E2E Project", cwd: work, sandbox: "read-only", approvalPolicy: "on-request" }] }));

// 1. Cloudflare quick tunnel
const cf = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:" + PORT], { stdio: ["ignore", "pipe", "pipe"] });
let cfOut = "";
cf.stdout.on("data", (d) => (cfOut += d)); cf.stderr.on("data", (d) => (cfOut += d));
let url = null;
for (let i = 0; i < 120 && !url; i++) { await sleep(250); url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(cfOut)?.[0] ?? null; }
if (!url) { console.log("no tunnel url", cfOut.slice(-500)); process.exit(1); }

// 2. Companion with real Codex
const env = { ...process.env, SULTI_DATA_DIR: dir, SULTI_PORT: String(PORT), SULTI_HOOK_PORT: "7618", SULTI_PUBLIC_URL: url };
delete env.SULTI_APP_SERVER_CMD;
let comp, compOut = "";
const startComp = async () => {
  compOut = "";
  comp = spawn(process.execPath, ["apps/companion/dist/cli.js", "start"], { env, stdio: ["pipe", "pipe", "pipe"] });
  comp.stdout.on("data", (d) => (compOut += d)); comp.stderr.on("data", (d) => (compOut += d));
  for (let i = 0; i < 200 && !/app-server ready/.test(compOut); i++) await sleep(100);
};
await startComp();
const pairCode = async () => (await (await fetch("http://127.0.0.1:7618/local/pair-code", { method: "POST", headers: { "x-sulti-hook-secret": JSON.parse(readFileSync(join(dir, "secrets.json"), "utf8")).hookSecret } })).json()).code;

// wait for the tunnel to route
let routed = false;
for (let i = 0; i < 60 && !routed; i++) { try { routed = (await fetch(url + "/api/health")).ok; } catch {} if (!routed) await sleep(1000); }

const out = { url: url.replace(/^https:\/\/([^.]{4})[^.]*/, "https://$1..."), steps: [] };
const browser = await pw.chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
let audioSrc = null;
page.on("request", (r) => { if (r.url().includes("/audio?")) audioSrc = r.url(); });
let n = 0;
async function step(name, fn) {
  const t0 = Date.now();
  try { const extra = await fn(); out.steps.push({ name, ok: true, s: ((Date.now() - t0) / 1000).toFixed(1), ...(extra ? { extra } : {}) }); }
  catch (e) { out.steps.push({ name, ok: false, s: ((Date.now() - t0) / 1000).toFixed(1), err: String(e.message).split("\n")[0].slice(0, 250) }); }
  await page.screenshot({ path: join(shots, String(++n).padStart(2, "0") + "-" + name.replace(/\W+/g, "-") + ".png") }).catch(() => {});
}
const row = page.locator("li.row").first();

await step("edge headers and compression", async () => {
  const html = await page.request.get(url + "/");
  const js = /\/assets\/index-[\w-]+\.js/.exec(await html.text())?.[0];
  const asset = await page.request.get(url + js, { headers: { "accept-encoding": "br, gzip" } });
  const h = html.headers(), a = asset.headers();
  return { hsts: h["strict-transport-security"], csp: !!h["content-security-policy"], htmlCache: h["cache-control"], jsEncoding: a["content-encoding"] ?? "none", jsCache: a["cache-control"], cfRay: !!h["cf-ray"] };
});
await step("pair through the tunnel", async () => {
  await page.goto(url + "/pair#code=" + (await pairCode()));
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("heading", { name: "Sessions", exact: true }).waitFor({ timeout: 20000 });
  await page.locator(".conn-pill.conn-open").waitFor({ timeout: 20000 });
});
await step("real Codex prompt", async () => {
  const t0 = Date.now();
  await page.goto(url + "/talk?to=e2e-project");
  await page.getByLabel("Message").fill("Reply with exactly this sentence and nothing else: The Sulti end to end check passed.");
  await page.getByRole("button", { name: /^Send to/ }).click();
  await row.getByText("Answer ready").waitFor({ timeout: 180000 });
  return { answerSeconds: ((Date.now() - t0) / 1000).toFixed(1), detail: await row.locator(".row-detail").innerText() };
});
await step("read answer and PC voice through tunnel", async () => {
  await row.locator(".row-main").click();
  const text = await page.getByRole("article", { name: "Answer" }).innerText();
  await page.getByRole("button", { name: /Switch voice/ }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.locator(".player .status").filter({ hasText: "Reading aloud" }).waitFor({ timeout: 60000 });
  await sleep(1500);
  const range = audioSrc ? await page.request.get(audioSrc, { headers: { range: "bytes=0-99" } }) : null;
  await page.getByRole("button", { name: "Stop reading" }).click();
  return { text: text.slice(0, 120), rangeStatus: range?.status(), contentRange: range?.headers()["content-range"] };
});
await step("real approval, declined", async () => {
  await page.goto(url + "/talk?to=e2e-project");
  await page.getByLabel("Message").fill("Create a file named sulti-check.txt in this folder containing the word hello. Do not do anything else.");
  await page.getByRole("button", { name: /^Send to/ }).click();
  const decline = page.getByRole("button", { name: "Decline" });
  const asked = await decline.waitFor({ timeout: 180000 }).then(() => true, () => false);
  if (!asked) return { asked: false, note: "Codex finished without asking" };
  const what = await page.locator(".cmd-box").innerText();
  await decline.click();
  await page.goto(url + "/s/e2e-project");
  await page.locator(".state-chip").filter({ hasText: /Idle|Last turn failed/ }).waitFor({ timeout: 180000 });
  const exists = existsSync(join(work, "sulti-check.txt"));
  return { asked: true, what: what.slice(0, 120), fileCreated: exists };
});
await step("companion restart, reconnect through tunnel", async () => {
  await page.goto(url + "/");
  await page.locator(".conn-pill.conn-open").waitFor();
  comp.kill();
  await page.getByText(/Can't reach your PC/).waitFor({ timeout: 30000 });
  await startComp();
  await page.getByText(/Can't reach your PC/).waitFor({ state: "detached", timeout: 60000 });
  await page.locator(".conn-pill.conn-open").waitFor({ timeout: 20000 });
});
await step("chat continues after restart", async () => {
  await page.goto(url + "/s/e2e-project");
  await page.getByRole("button", { name: /^Chat:/ }).click();
  await page.locator(".sheet li.row").first().waitFor({ timeout: 20000 });
  return { chats: await page.locator(".sheet li.row").count() };
});

await browser.close();
comp.kill(); cf.kill();
await sleep(1000);
rmSync(dir, { recursive: true, force: true });
console.log("\nlive (" + out.url + "): " + out.steps.filter((s) => s.ok).length + "/" + out.steps.length + " steps passed");
for (const s of out.steps) console.log(`  ${s.ok ? "ok  " : "FAIL"} ${s.name} (${s.s} s)${s.err ? "\n       " + s.err : ""}${s.extra ? "\n       " + JSON.stringify(s.extra) : ""}`);
for (const e of errors) console.log("  page error: " + e);
process.exit(out.steps.every((s) => s.ok) && !errors.length ? 0 : 1);
