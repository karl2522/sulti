// End-to-end walkthrough of every phone flow: the real companion CLI with real
// Windows TTS, clipboard and Stop hook, a mock Codex app-server, driven in a
// real browser engine. No Codex usage. Run before a release:
//   npm run build && npm run e2e
// Needs the Playwright browsers once: npx playwright-core install chromium webkit
// Screenshots of every step land in test/live-output/e2e-<engine>/.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pw from "playwright-core";
const engine = process.argv[2] ?? "chromium";
const PORT = 7517, HOOK = 7518, base = "http://127.0.0.1:" + PORT;
const shots = join("test", "live-output", "e2e-" + engine);
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });

// ---------- companion ----------
const dir = mkdtempSync(join(tmpdir(), "sulti-e2e-"));
const names = ["sole-harbor", "lead-tracker", "kernel-labs"];
for (const n of names) mkdirSync(join(dir, "work", n), { recursive: true });
writeFileSync(join(dir, "sessions.json"), JSON.stringify({ sessions: [
  { name: "Sole Harbor", cwd: join(dir, "work", "sole-harbor"), aliases: ["soul harbor"] },
  { name: "Lead Tracker", cwd: join(dir, "work", "lead-tracker"), aliases: ["led tracker"], sandbox: "read-only" },
  { name: "Kernel Labs", cwd: join(dir, "work", "kernel-labs"), aliases: ["colonel labs"] },
] }));
const env = { ...process.env, SULTI_DATA_DIR: dir, SULTI_PORT: String(PORT), SULTI_HOOK_PORT: String(HOOK), SULTI_PUBLIC_URL: base,
  SULTI_APP_SERVER_CMD: JSON.stringify([process.execPath, join(process.cwd(), "test", "mock-app-server", "server.mjs"), "--delay", "40"]) };
let comp = null, compOut = "";
function startCompanion() {
  return new Promise((resolve, reject) => {
    compOut = "";
    comp = spawn(process.execPath, ["apps/companion/dist/cli.js", "start"], { env, stdio: ["pipe", "pipe", "pipe"] });
    comp.stdout.on("data", (d) => (compOut += d));
    comp.stderr.on("data", (d) => (compOut += d));
    const t = setInterval(() => { if (/app-server ready/.test(compOut)) { clearInterval(t); resolve(); } }, 50);
    setTimeout(() => { clearInterval(t); reject(new Error("companion did not start: " + compOut.slice(-400))); }, 20000);
  });
}
// The same route "npm run pair" uses (the companion never prints codes when its output isn't a terminal).
async function newCode() {
  const secret = JSON.parse(readFileSync(join(dir, "secrets.json"), "utf8")).hookSecret;
  const res = await fetch("http://127.0.0.1:" + HOOK + "/local/pair-code", { method: "POST", headers: { "x-sulti-hook-secret": secret } });
  return (await res.json()).code;
}
const stopCompanion = () => new Promise((r) => { comp.once("exit", r); comp.kill(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cli = (...args) => spawnSync(process.execPath, ["apps/companion/dist/cli.js", ...args], { env, encoding: "utf8" });

// ---------- browser ----------
const launch = engine === "webkit"
  ? pw.webkit.launch({ headless: true })
  : pw.chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const browser = await launch;
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: engine === "chromium", hasTouch: true });
if (engine === "chromium") await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
await page.addInitScript(() => {
  window.__long = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true }); } catch {}
});

const results = [];
let n = 0;
async function step(name, fn) {
  const t0 = Date.now();
  const id = String(++n).padStart(2, "0");
  try {
    await fn();
    results.push({ id, name, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ id, name, ok: false, ms: Date.now() - t0, err: String(e.message).split("\n")[0].slice(0, 300) });
  }
  await page.screenshot({ path: join(shots, id + "-" + name.replace(/[^\w]+/g, "-").slice(0, 40) + ".png") }).catch(() => {});
}
const go = (p) => page.evaluate((p) => { history.pushState({ depth: 1 }, "", p); dispatchEvent(new PopStateEvent("popstate", { state: { depth: 1 } })); }, p);
const toast = (re, timeout = 10000) => page.locator(".toast").filter({ hasText: re }).first().waitFor({ timeout });
const row = (name) => page.locator("li.row").filter({ hasText: name }).first();
const home = async () => { await go("/"); await page.getByRole("heading", { name: "Sessions", exact: true }).waitFor(); };
async function talk(session, text) {
  await go("/talk?to=" + session);
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: /^Send to/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/talk"), { timeout: 5000 });
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// "Copy to PC" writes the real clipboard; put the owner's clipboard back afterwards.
const ps = (cmd, input) => spawnSync("powershell.exe", ["-NoProfile", "-Command", cmd], { encoding: "utf8", input });
const savedClipboard = ps("Get-Clipboard -Raw").stdout ?? "";
const notes = [];
await startCompanion();

await step("pair from link", async () => {
  await page.goto(base + "/pair#code=" + (await newCode()));
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("heading", { name: "Sessions", exact: true }).waitFor({ timeout: 10000 });
  expect((await page.locator("li.row").count()) === 3, "expected 3 sessions");
  await page.locator(".conn-pill.conn-open").waitFor();
});

await step("prompt and answer", async () => {
  await go("/talk?to=sole-harbor");
  await page.getByLabel("Message").fill("run the tests");
  await page.getByText("Prompt to Codex").waitFor();
  await page.getByRole("button", { name: /^Send to/ }).click();
  await row("Sole Harbor").getByText("Answer ready").waitFor({ timeout: 15000 });
});

await step("reader and PC voice", async () => {
  await row("Sole Harbor").locator(".row-main").click();
  await page.getByRole("article", { name: "Answer" }).waitFor();
  await page.getByRole("button", { name: /Switch voice/ }).click();
  await page.getByRole("button", { name: "Voice: PC voice. Switch voice" }).waitFor();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.locator(".player .status").filter({ hasText: "Reading aloud" }).waitFor({ timeout: 30000 });
  await sleep(1500);
  await page.getByRole("button", { name: "Next sentence" }).click();
  await sleep(500);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.locator(".player .status").filter({ hasText: "Paused" }).waitFor();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.locator(".player .status").filter({ hasText: "Reading aloud" }).waitFor();
  await page.getByRole("button", { name: "Stop reading" }).click();
  await page.locator(".player .status").filter({ hasText: "Ready to read" }).waitFor();
});

await step("unsigned audio links are refused", async () => {
  const id = page.url().split("/a/")[1];
  const res = await page.request.get(base + "/api/answers/" + id + "/audio");
  expect(res.status() === 403, "unsigned audio must be refused, got " + res.status());
});

await step("phone voice", async () => {
  await page.getByRole("button", { name: /Switch voice/ }).click();
  await page.getByRole("button", { name: "Voice: phone voice. Switch voice" }).waitFor();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await sleep(1500);
  const status = await page.locator(".player .status").innerText();
  const toasts = await page.locator(".toast").allInnerTexts();
  notes.push("phone voice: " + status + (toasts.length ? " (" + toasts.join(" / ") + ")" : ""));
  await page.getByRole("button", { name: "Stop reading" }).click().catch(() => {});
});

await step("copy to PC and phone", async () => {
  await page.getByRole("button", { name: "Copy answer" }).click();
  await page.getByRole("button", { name: "Copy to the PC clipboard" }).click();
  await toast(/PC clipboard/);
  const clip = ps("Get-Clipboard -Raw").stdout;
  expect(/checkout tests pass/i.test(clip), "PC clipboard has: " + clip.slice(0, 80));
  await page.getByRole("button", { name: "Copy answer" }).click();
  await page.getByRole("button", { name: "Copy on this phone" }).click();
  await toast(/Copied\.|blocked copying/);
});

await step("text size and speed", async () => {
  const art = page.getByRole("article", { name: "Answer" });
  const before = await art.getAttribute("class");
  await page.getByRole("button", { name: "Text size" }).click();
  expect((await art.getAttribute("class")) !== before, "text size did not change");
  await page.getByRole("button", { name: /Reading speed 1 times/ }).click();
  await page.getByRole("button", { name: /Reading speed 1.25 times/ }).waitFor();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("sulti.settings")).rate);
  expect(saved === 1.25, "speed not saved");
});

await step("goal set pause resume clear", async () => {
  await go("/s/lead-tracker");
  await page.getByRole("button", { name: "Set a goal" }).click();
  await page.getByRole("textbox", { name: "Goal" }).fill("Make the import resilient");
  await page.getByRole("button", { name: "Set goal" }).click();
  const goal = page.getByRole("region", { name: "Goal" });
  await goal.getByText("Active").waitFor();
  await goal.getByRole("button", { name: "Pause" }).click();
  await goal.getByText("Paused").waitFor();
  await goal.getByRole("button", { name: "Resume" }).click();
  await goal.getByText("Active").waitFor();
  await goal.getByRole("button", { name: "Clear" }).click();
  await goal.getByRole("button", { name: "Tap to clear" }).click();
  await goal.getByText(/No goal yet/).waitFor();
});

await step("skill", async () => {
  await go("/s/lead-tracker");
  await page.getByRole("button", { name: /^Use / }).first().click();
  await page.locator(".skill-chip.on").waitFor();
  await page.getByRole("button", { name: /^Send to/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/talk"), { timeout: 5000 });
  await toast(/^Sent \$/);
});

await step("approval decline then approve", async () => {
  await talk("lead-tracker", "[scenario:approval] run the test suite");
  await page.getByRole("button", { name: "Decline" }).click({ timeout: 15000 });
  await page.waitForFunction(() => document.body.innerText.includes("declined"), null, { timeout: 15000 }).catch(() => {});
  await talk("lead-tracker", "[scenario:approval] run the test suite again");
  await page.getByRole("button", { name: "Approve once" }).click({ timeout: 15000 });
  await go("/s/lead-tracker");
  await page.locator(".state-chip").filter({ hasText: "Idle" }).waitFor({ timeout: 15000 });
});

await step("voice approve never approves", async () => {
  await talk("lead-tracker", "[scenario:approval] run it once more");
  await page.getByRole("button", { name: "Decline" }).waitFor({ timeout: 15000 });
  await page.keyboard.press("Escape");
  await sleep(400);
  await talk("lead-tracker", "approve");
  await page.getByRole("button", { name: "Decline" }).waitFor({ timeout: 5000 }); // sheet re-opened, nothing approved
  await page.getByRole("button", { name: "Decline" }).click();
});

await step("steer and stop turn", async () => {
  await talk("kernel-labs", "[scenario:interrupted] investigate the auth module");
  await go("/s/kernel-labs");
  await page.getByRole("button", { name: "Stop turn" }).waitFor({ timeout: 10000 });
  await go("/talk?to=kernel-labs");
  await page.getByLabel("Message").fill("also check logout");
  await page.getByText(/joins the current turn/).waitFor();
  await page.getByRole("button", { name: /^Send to/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/talk"), { timeout: 5000 });
  await go("/s/kernel-labs");
  await page.getByRole("button", { name: "Stop turn" }).click();
  await toast(/stopped/i);
  await page.locator(".state-chip").filter({ hasText: "Idle" }).waitFor({ timeout: 10000 });
});

await step("failed turn", async () => {
  await talk("kernel-labs", "[scenario:failed-usage-limit] do it");
  await toast(/usage limit/i, 15000);
  await home();
  await row("Kernel Labs").getByText("Last turn failed").waitFor();
});

await step("chats new chat and /new", async () => {
  await go("/s/sole-harbor");
  await page.getByRole("button", { name: /^Chat:/ }).click();
  await page.getByRole("heading", { name: "Chats" }).waitFor();
  await page.locator(".sheet").getByRole("button", { name: /New chat/ }).click();
  await page.getByRole("button", { name: /^Chat: New chat/ }).waitFor();
  await go("/talk?to=sole-harbor");
  await page.getByLabel("Message").fill("/new check the docs");
  await page.getByText("Start a new chat").waitFor();
  await page.getByRole("button", { name: /^Send to/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/talk"), { timeout: 5000 });
  await go("/s/sole-harbor");
  await page.getByRole("button", { name: /^Chat: Check the docs|^Chat: check the docs/ }).waitFor({ timeout: 15000 });
});

await step("switch chats", async () => {
  await page.getByRole("button", { name: /^Chat:/ }).click();
  const older = page.locator(".sheet li.row").filter({ hasText: /Run the tests/i }).first();
  await older.click();
  await page.getByRole("button", { name: /^Chat: Run the tests/i }).waitFor({ timeout: 10000 });
});

await step("voice switch and unclear switch", async () => {
  await talk("sole-harbor", "switch to colonel labs");
  await home();
  await row("Kernel Labs").getByText("Active").waitFor({ timeout: 5000 });
  await talk("kernel-labs", "switch to bananas");
  await page.getByRole("heading", { name: /Which session\?/ }).waitFor();
  await page.keyboard.press("Escape");
});

await step("stop hook from a terminal", async () => {
  const payload = { hook_event_name: "Stop", cwd: join(dir, "elsewhere", "demo-app"), session_id: "s1", turn_id: "hook-turn-1", last_assistant_message: "Demo app is done. Tests pass." };
  const r = spawnSync(process.execPath, ["scripts/hooks/stop-hook.mjs"], { env, input: JSON.stringify(payload), encoding: "utf8" });
  expect(r.status === 0 && !r.stdout, "hook exit " + r.status + " out " + r.stdout);
  await home();
  await row("demo-app").getByText("Answer ready").waitFor({ timeout: 5000 });
  await go("/s/unlisted-demo-app");
  await page.getByText("Listen only").waitFor();
});

await step("restart companion and reconnect", async () => {
  await home();
  await stopCompanion();
  await page.getByText(/Can't reach your PC/).waitFor({ timeout: 15000 });
  await startCompanion();
  await page.getByText(/Can't reach your PC/).waitFor({ state: "detached", timeout: 30000 });
  await row("demo-app").waitFor({ timeout: 5000 });
  await row("Sole Harbor").waitFor();
});

await step("missing answer link", async () => {
  await go("/a/does-not-exist");
  await page.getByText("This answer isn't here anymore").waitFor();
});

await step("revoke drops the phone", async () => {
  await home();
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem("sulti.device")).deviceId);
  const out = cli("devices", "revoke", id);
  expect(/Revoked/.test(out.stdout), "revoke said: " + out.stdout + out.stderr);
  await talk("sole-harbor", "hello");
  await page.getByRole("heading", { name: "Connect this phone" }).waitFor({ timeout: 40000 });
});

await step("pair with typed code", async () => {
  const code = await newCode();
  await page.goto(base + "/");
  await page.getByLabel("Pairing code").fill(code.slice(0, 5) + "-" + code.slice(5));
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("heading", { name: "Sessions", exact: true }).waitFor({ timeout: 10000 });
});

await step("wrong pairing code", async () => {
  await page.evaluate(() => localStorage.removeItem("sulti.device"));
  await page.goto(base + "/");
  await page.getByLabel("Pairing code").fill("WRONGCODE9");
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("alert").waitFor();
  notes.push("wrong code: " + (await page.getByRole("alert").innerText()));
  const code = await newCode();
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("heading", { name: "Sessions", exact: true }).waitFor({ timeout: 10000 });
});

await step("settings and forget", async () => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "1.5\u00d7" }).click();
  await page.getByRole("radio", { name: "Read automatically" }).click();
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("sulti.settings")));
  expect(s.rate === 1.5 && s.autoRead === "auto", "settings not saved " + JSON.stringify(s));
  await page.getByRole("button", { name: "Forget this phone" }).click();
  await page.getByRole("button", { name: "Tap again to forget this phone" }).click();
  await page.getByRole("heading", { name: "Connect this phone" }).waitFor();
});

const long = await page.evaluate(() => window.__long ?? []).catch(() => []);
await browser.close();
await stopCompanion();
ps("$input | Set-Clipboard", savedClipboard);
rmSync(dir, { recursive: true, force: true });
const companionWarnings = compOut.split("\n").filter((l) => /error|failed|unexpected/i.test(l) && !/paired|closed by client|no rollout found/.test(l));
console.log(`\n${engine}: ${results.filter((r) => r.ok).length}/${results.length} steps passed`);
for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name} (${r.ms} ms)${r.err ? "\n       " + r.err : ""}`);
for (const x of notes) console.log("  note: " + x);
// Expected: the 401 from the deliberate wrong code, and the dropped socket while the companion restarts.
const unexpected = errors.filter((e) => !/401|WebSocket/.test(e));
for (const e of unexpected) console.log("  page error: " + e);
for (const e of companionWarnings) console.log("  companion: " + e.trim());
const slow = long.filter((d) => d > 100);
if (slow.length) console.log("  main-thread stalls over 100 ms: " + slow.join(", "));
process.exit(results.every((r) => r.ok) && !unexpected.length ? 0 : 1);
