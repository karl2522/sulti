# Sulti — build prompt

Working name: **Sulti** (Cebuano for "speak"). Keep the name in one constant so it's easy to rename.

## 0. Goal

Build a working, tested prototype of Sulti and publish it to a new **public** GitHub repository created through the **connected GitHub MCP server**.

Sulti has two parts:

- **Windows companion** (Node.js + TypeScript). It runs on the owner's PC, drives Codex through `codex app-server`, receives finished answers from the owner's existing Codex terminals through a Stop hook, renders speech audio, and serves the phone app.
- **iPhone web app** (Vite + React + TypeScript, installable to the Home Screen). It lets the owner *listen* to complete Codex answers and *talk* to multiple Codex sessions: switch projects, send prompts, invoke skills, manage goals, stop turns, and approve actions.

Work as an orchestrator that delegates to subagents (Section 4). Keep going until every agent-verifiable item in Section 1 passes, then write the final report (Section 10). Don't stop to ask questions unless you hit a hard stop (Section 3). Otherwise pick a sensible default, log it in `docs/DECISIONS.md`, and continue.

## 1. Definition of done

### Agent-verifiable (you make these pass)

- [ ] Public repo `sulti` (fallback `sulti-app`) created via the GitHub MCP. Default branch `main`, all work pushed, visibility confirmed **public** via the MCP.
- [ ] From a clean clone on Windows, these all succeed: `npm ci`, `npm run build`, `npm run typecheck`, `npm test`.
- [ ] Unit tests cover:
  - the intent router (full corpus in Section 9)
  - the fuzzy matcher
  - final-answer extraction from recorded app-server event fixtures
  - the speech-text normalizer
  - Stop-hook payload parsing
  - pairing and auth
  - signed audio URLs
- [ ] Integration tests run the companion against a **mock app-server** (JSONL over stdio), with zero Codex usage.
- [ ] `npm run smoke:live` exists and either passed once against real Codex or is marked NEEDS-OWNER with the exact reason.
- [ ] The two-client shared-session experiment (T5) ran, and its result is recorded.
- [ ] `npm run scan` (secret scan) passes on every tracked file, and `.gitignore` covers all local data.
- [ ] GitHub Actions CI is green: `windows-latest`, install, typecheck, and tests with mocks.
- [ ] These docs exist: `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/PROTOCOL_NOTES.md`, `docs/MANUAL_TESTS.md`, `docs/REPORT.md`, `docs/BUILD_PROMPT.md` (this prompt).

### Owner-verified (you write step-by-step checklists in `docs/MANUAL_TESTS.md`)

- [ ] A 5-minute answer plays to the end on the iPhone with the screen locked. Test both playback modes, both as a Safari tab and as a Home Screen app.
- [ ] Lock-screen and AirPods play/pause work for PC-rendered audio.
- [ ] Prompts from the phone reach the right session across two projects, and skills, goals, stop, and approvals all work.
- [ ] If T5 passes: a terminal attached with `codex --remote` shows a turn started from the phone.

## 2. Context and verified facts

The owner runs several Codex sessions across multiple projects on a Windows 11 laptop with three monitors. They want to work away from the keyboard: hear complete answers, switch projects, send prompts, and use skills and goals from an iPhone.

OpenAI's ChatGPT mobile app already offers Codex remote control. Sulti focuses on what that app lacks today: complete read-aloud and voice-first routing across many sessions, all local-first.

The facts below come from OpenAI's docs as of late October 2026. **Your installed Codex version is the source of truth.** Confirm each fact in T1. Where reality differs, follow the installed version and record the difference in `docs/PROTOCOL_NOTES.md`.

### App-server protocol

- **Transport.** `codex app-server` speaks JSON-RPC 2.0 as newline-delimited JSON over stdio by default. The `"jsonrpc":"2.0"` field is omitted on the wire.
- **Handshake.** Every connection sends `initialize` (with `clientInfo`) and then the `initialized` notification before any other request.
- **Types.** Generate version-matched types with `codex app-server generate-ts --out <dir>` (there's also `generate-json-schema`).
- **Primitives.** A *thread* is a conversation with a `cwd`. A *turn* is one request plus the agent's work. An *item* is a unit inside a turn: a user message, agent message, command run, file change, and so on.
- **Methods Sulti uses.**
  - Threads: `thread/start`, `thread/resume`, `thread/list` (filterable by `cwd`), `thread/read`.
  - Turns: `turn/start`, `turn/interrupt`.
  - Skills: `skills/list` (per `cwd`).
  - Goals: `thread/goal/set`, `thread/goal/get`, `thread/goal/clear`. These use the same state as `/goal` in the TUI, and the objective must be non-empty and at most 4,000 characters.
  - Models: `model/list`. Don't hardcode a model; omit it to use the owner's default.
- **Notifications.**
  - `turn/started` and `turn/completed` (status `completed`, `interrupted`, or `failed`).
  - `item/started`, and `item/completed`, which carries the authoritative final state.
  - `item/agentMessage/delta`, `thread/status/changed`, `error`.
- **Final answer.** `agentMessage` items carry `text` and an optional `phase`: `commentary`, `partial_answer`, or `final_answer`. **The answer to read aloud** is the `final_answer` agent-message text of a completed turn. If no phase is present, fall back to the last `agentMessage` of the turn.
- **Explicit skill invocation.** Put `$<skill-name>` in the text input **and** add an input item `{ "type": "skill", "name": "<skill-name>", "path": "<SKILL.md path from skills/list>" }`.
- **Approvals.** These arrive as server-initiated requests: `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`. Answer with `accept`, `acceptForSession`, `decline`, or `cancel`.
- **Unsandboxed methods.** `thread/shellCommand`, `command/exec`, and `process/*` run commands outside the thread's sandbox. They must **never** be reachable from phone-triggered code.
- **Windows sandbox.** Windows may need sandbox setup (`windowsSandbox/setupStart`); check in T1.

### Shared mode (experimental)

- `codex app-server --listen ws://127.0.0.1:4500` accepts multiple clients. The normal TUI attaches with `codex --remote ws://127.0.0.1:4500`.
- The WebSocket transport is experimental and unsupported. Non-loopback listeners accept unauthenticated connections by default.
- Auth:
  - Server: `--ws-auth capability-token --ws-token-file <absolute path>`.
  - Clients: send `Authorization: Bearer <token>` in the handshake.
  - TUI: `--remote-auth-token-env <ENV_VAR>`.

### Stop hook

- Codex can run a command when the main agent finishes a turn. The payload includes the final assistant message (`last_assistant_message`) plus identifiers such as `cwd`, session id, and turn id.
- Hooks run synchronously and block the turn while they run. Stop hooks can also influence whether Codex continues, so Sulti's hook must be a pure observer: no output, exit code 0, fast.
- Legacy alternative: the `notify` setting. It fires an `agent-turn-complete` event with `last-assistant-message`, passes the JSON as the last command-line argument, and works only in user-level config.
- Verify for the installed version:
  - config syntax and location (`config.toml` vs `hooks.json`)
  - any feature flag
  - stdin vs argv delivery
  - exact payload field names
  - output and exit-code semantics

### iPhone constraints

- **HTTPS.** The microphone and several web APIs require HTTPS. An HTTPS page can't open a plain `ws://` connection to a LAN address, and self-signed certificates are painful on iOS.
- **Background audio.** Home Screen web apps have a history of audio stopping when they leave the foreground, and speech synthesis can pause on screen lock. That's why Sulti ships **two playback modes** for the owner to compare.
- **Connectivity.** For the prototype, Tailscale Serve proxies `https://<pc>.<tailnet>.ts.net` to the companion on `127.0.0.1`. This solves both HTTPS and away-from-home access without a server of ours. Setting it up is an owner step.

## 3. Hard rules

**The repo is public.** Never commit any of the following:

- tokens or secrets
- `.env*` files
- anything from `~/.codex` (especially `auth.json`)
- Tailscale hostnames (`*.ts.net`)
- absolute user paths (`C:\Users\…`, `/Users/…`)
- real project names
- captured prompts, answers, or hook payloads
- logs

Use only the fictional names in Section 9 for examples, fixtures, and tests.

**Security**

1. Bind every listener to `127.0.0.1`. Never `0.0.0.0` or a LAN IP.
2. Never read, copy, or transmit Codex credentials.
3. No phone-triggered path may reach `thread/shellCommand`, `command/exec`, or `process/*`. "Run the tests" becomes a Codex prompt, never a shell command.
4. Approvals require a tap. Voice can never approve anything.
5. Don't install third-party "Codex remote/web UI" packages; malicious ones have been reported stealing auth tokens. Use well-known packages, pin exact versions, and keep dependencies few.
6. No telemetry or analytics. Make outbound network calls only to npm, GitHub (MCP or git), and Codex itself.

**Hard stops: pause and ask the owner before you do any of these.**

- Spending money.
- Editing global configuration (`~/.codex/config.toml`, Tailscale, Windows settings). Write scripts and docs instead, and don't run them.
- Deleting anything outside the repo.
- Exposing anything beyond loopback.
- Creating any GitHub repository other than `sulti` / `sulti-app`.

**Codex usage costs the owner's plan.** Across all live tests, use at most 8 turns in total, with tiny prompts, a temp directory, and a read-only sandbox where possible.

## 4. Working mode: orchestrator + subagents

You are the orchestrator. Use subagents for independent workstreams, with up to 4 running at once. If subagents aren't available, run the same workstreams sequentially in the order below.

Before starting parallel work, write the repo skeleton and the wire contract (`packages/core/src/wire.ts`, Section 7) yourself. That way every subagent builds against the same interfaces.

Give each subagent a self-contained brief with:

- its goal
- the paths it owns (it edits only those)
- the relevant contracts and facts from this prompt
- its acceptance tests
- this report format:

> **Report:** what was built · files changed · tests added and results · deviations from the brief · open questions · owner actions needed

| Subagent | Tasks | Owns |
|---|---|---|
| `protocol-scout` | T1 | `packages/protocol/`, `test/fixtures/app-server/`, `docs/PROTOCOL_NOTES.md` |
| `qa-security` | TQ, T6 | `test/` (except fixtures), `tools/stt-bench/`, `.github/`, `docs/MANUAL_TESTS.md` |
| `companion-core` | T2, T4 (server side) | `apps/companion/src/` except `listen/`; `packages/core/` except `wire.ts` |
| `listen` | T3 (companion side) | `apps/companion/src/listen/`, `apps/companion/scripts/`, `scripts/hooks/` |
| `phone-ui` | T3 + T4 (UI) | `apps/phone/` |
| `shared-session-lab` | T5 | `tools/shared-session/` |

**Schedule:**

1. T0 (you).
2. T1 and TQ in parallel.
3. T2, T3, and T4 in parallel.
4. T5.
5. T6 (optional).
6. T7 (you).

After each merge, run `npm run typecheck && npm test && npm run scan`, commit with a conventional message, and push.

## 5. Tasks

### T0 — Bootstrap and public GitHub repo (orchestrator, first)

1. **Skeleton.** Create the layout in Section 6 with:
   - npm workspaces
   - TypeScript (strict)
   - Vitest
   - `engines.node` set to `>=22`
   - `.editorconfig`
   - a stub `README.md`
   - `docs/DECISIONS.md`

   Save this prompt as `docs/BUILD_PROMPT.md`, moving it there if it was given as a file. Write `packages/core/src/wire.ts` from Section 7.
2. **`.gitignore`.** Cover at least: `node_modules/`, `dist/`, `coverage/`, `.sulti/`, `*.log`, `.env*`, `sessions.json`, `test/live-output/`, `tools/stt-bench/models/`, `tools/stt-bench/audio/`.
3. **Secret scan.** Write `tools/secret-scan.mjs` with no dependencies. It scans all tracked files for:
   - `ghp_`, `github_pat_`, `sk-`, `-----BEGIN`
   - `auth.json` contents
   - `.ts.net`
   - `C:\Users\` and `/Users/`
   - long high-entropy strings

   It exits non-zero on any hit. Wire it as `npm run scan` and run it before every push.
4. **Create the repo with the connected GitHub MCP server:**
   - Identify the authenticated user.
   - Create a **public** repository named `sulti` (if taken, `sulti-app`), without auto-init. Description: *"Voice-first iPhone remote for Codex sessions on Windows: hear complete answers, route prompts by voice. Prototype."*
   - Add topics if supported: `codex`, `voice`, `windows`, `iphone`, `pwa`, `typescript`.
5. **First push.** Push the first commit:
   - Prefer local git: `git remote add origin <https-url>`, then `git push -u origin main`.
   - If git has no credentials, push through the MCP's file or commit tools.
   - Then confirm via the MCP that the repo is public and the README is there.
6. **No MCP fallback.** If no GitHub MCP server is connected, continue with all other tasks. Put the exact manual commands in `docs/REPORT.md` (for example `gh repo create sulti --public --source . --push`).
7. **Licensing.** Add **no** open-source license yet. Put both of these in the README:
   - *"License: not yet decided — all rights reserved for now."*
   - *"Not affiliated with OpenAI. Codex is a trademark of OpenAI."*

### T1 — Protocol verification (`protocol-scout`)

1. **Versions.** Record `codex --version`, `node --version`, and the Windows version in `docs/PROTOCOL_NOTES.md`.
2. **Types.** Generate types with `codex app-server generate-ts --out packages/protocol/src/generated`. Add `npm run gen:protocol`, and store the Codex version in `packages/protocol/CODEX_VERSION`.
3. **Confirm the facts.** Read the official docs for the installed version (app-server, hooks, remote connections) and the generated types. Confirm or correct every fact in Section 2, especially:
   - `thread/start` approval-policy and sandbox enum values
   - goal status values
   - the skill input item
   - `agentMessage.phase`
   - the Stop hook: config, payload, stdin vs argv, output semantics, feature flag
   - WebSocket auth flags
   - Windows sandbox setup
4. **Fixtures.** Build JSONL fixtures for:
   - a normal turn (commentary plus final answer)
   - an interrupted turn
   - a failed turn (usage limit)
   - a turn with a command approval
   - a skill turn

   Prefer a live capture of at most 2 turns in a temp directory; otherwise hand-build the fixtures from the generated types. Strip anything personal.
5. **Client.** Write a typed, transport-agnostic JSON-RPC client in `packages/protocol/src/client.ts` that works over stdio and WebSocket. It handles line framing, request/response correlation, notifications, server-initiated requests, timeouts, and clean shutdown.

### TQ — Test infrastructure (`qa-security`)

1. **Mock app-server.** Build `test/mock-app-server/`: a Node script that speaks JSONL on stdio. It implements:
   - `initialize` / `initialized`
   - `thread/start`, `thread/resume`, `thread/list`
   - `turn/start`, which replays a chosen fixture
   - `turn/interrupt`
   - `skills/list`
   - `thread/goal/*`
   - server-initiated approval requests

   A `--scenario` flag selects the fixture.
2. **Integration tests.** Run the companion with the mock app-server and a WebSocket test client acting as the phone. Cover:
   - prompt → final answer
   - the approval round trip
   - interrupt
   - goal set/get
   - skill invocation
   - deduplication of hook answers against app-server answers
3. **CI.** `.github/workflows/ci.yml` runs on `windows-latest`: install, typecheck, and test (mocks only, no Codex).
4. **Manual tests.** Write the skeleton of `docs/MANUAL_TESTS.md`; the orchestrator finalizes it in T7.

### T2 — Companion core (`companion-core`)

1. **Data dir.** Use `%APPDATA%\sulti`, overridable with `SULTI_DATA_DIR`. It holds:
   - `config.json`
   - `sessions.json`
   - `secrets.json` (hook secret and signing secret)
   - `devices.json` (SHA-256 hashes of device tokens)
   - `threads.json` (session → thread id)
   - `answers/` (one JSON file per answer; keep the last 200)

   Commit `sessions.example.json` with the fictional names.
2. **Session config.** Fields: `name`, `cwd`, `aliases[]`, `sandbox`, `approvalPolicy`. Defaults: workspace-write sandbox and on-request approvals, using the enum names confirmed in T1.
3. **Spawning Codex on Windows.** A `codex` installed through npm is a `.cmd` shim, and recent Node versions refuse to spawn `.cmd`/`.bat` files without `shell: true`. Resolve the executable (prefer a native `codex.exe` if present), quote arguments safely, and test both cases.
4. **Two listeners, both on `127.0.0.1`.**
   - **Phone server** on port `7417` (`SULTI_PORT`). It serves:
     - the built phone app
     - `POST /api/pair`
     - `GET /api/answers/:id/audio?exp=…&sig=…`, with an HMAC signature and 10-minute expiry, because `<audio>` can't send auth headers
     - WebSocket `/ws`

     This is the only port Tailscale Serve will proxy.
   - **Local control server** on port `7418` (`SULTI_HOOK_PORT`). It serves only `POST /hook/stop` and requires the `X-Sulti-Hook-Secret` header. It is never proxied.
5. **Pairing.**
   - On start, print a QR code and the URL `${PUBLIC_URL}/pair#code=<one-time code>` in the terminal. Codes are single-use, expire after 10 minutes, and are rate-limited.
   - `PUBLIC_URL` comes from config, or from `tailscale status --json` (`Self.DNSName` with the trailing dot removed) if available.
   - Exchanging the code returns a random 32-byte device token. Store only its hash.
   - Add a CLI: `sulti devices list` and `sulti devices revoke <id>`.
6. **WebSocket auth.** Close the socket unless both conditions hold:
   - The first message is `{type:"auth", deviceToken}` and arrives within 5 seconds.
   - `Origin` matches `PUBLIC_URL`. Allow `http://localhost:5173` only in dev mode.
7. **App-server manager.**
   - Spawn `codex app-server` over stdio and handshake with `clientInfo: { name: "sulti", title: "Sulti", version }`.
   - Restart with backoff on crash, and resume known threads after a restart.
   - Per session: lazily `thread/start` with its `cwd` and policies, persist the thread id, and `thread/resume` on later runs.
   - Add a `shared` mode that connects to `ws://127.0.0.1:4500` with a capability token instead of spawning (used by T5).
8. **Turn handling.**
   - Track turn status per session.
   - Extract final answers (Section 2) and emit `answer` events with `source: "appServer"`.
   - Forward approval requests to the phone and relay the decision.
   - Map errors (usage limit, connection failures) to short, speakable messages.
9. **`packages/core/`.** Pure TypeScript with no Node APIs, shared with the phone.
   - **Intent router.** Output is one of:
     - `{kind:"app", action}`
     - `{kind:"codex", action: "goal.set" | "goal.get" | "goal.update" | "goal.clear" | "interrupt" | "skill", …}`
     - `{kind:"prompt", sessionId, text}`

     Each result also carries `confidence` and `needsConfirm`. For session resolution, an explicit name in the utterance ("in Kernel Labs, …", "tell Lead Tracker to …") wins; otherwise use the active session. Strip routing words from the prompt text.
   - **Fuzzy matcher.**
     - Normalize first: lowercase, strip punctuation, treat a hyphen as a space, convert number words to digits.
     - Then combine Jaro-Winkler with a phonetic key (a small MIT library such as Double Metaphone, or your own implementation).
     - Match against session names, aliases, and `skills/list` names.
     - Below the threshold → `needsConfirm`.
   - **Prompt cleanup.** Capitalize the first letter, add final punctuation, and remove filler ("um", "uh", or "like" at the start of a sentence). Never rewrite meaning.
10. **`npm run smoke:live`.** Create one throwaway session in a temp dir with a read-only sandbox, then:
    - Send "Reply with only the word PONG." and assert that the final answer contains PONG.
    - Start a longer turn, interrupt it after the first delta, and assert status `interrupted`.

    Use at most 2 turns.

### T3 — Listen half (`listen` + `phone-ui`)

1. **`scripts/hooks/stop-hook.mjs`** (no dependencies).
   - Read JSON from stdin, falling back to the last argv argument.
   - Extract `cwd`, the session and turn ids, and the final message.
   - POST to `http://127.0.0.1:7418/hook/stop` with the secret (from `%APPDATA%\sulti\secrets.json` or `SULTI_HOOK_SECRET`) and a 1,500 ms timeout.
   - Print nothing and always exit 0. On error, append one line without message content to `%APPDATA%\sulti\hook-errors.log`.
   - A `--debug` flag saves the raw payload into the data dir (never the repo), so the owner can verify field names.
2. **`scripts/hooks/install-hook.ps1`.** Back up the Codex config, then append the Stop-hook block (the syntax verified in T1), using a TOML literal string for the Windows path. Make it idempotent, with an `-Uninstall` switch. **Don't run it**; the owner will.
3. **`POST /hook/stop`.**
   - Map `cwd` to a session using case-insensitive Windows path normalization. An unknown folder becomes an "unlisted" session named after the folder.
   - Dedupe against app-server answers by turn id.
   - Store and broadcast the answer.
4. **Speech-text normalizer** (in `packages/core/`). Convert markdown to speakable text:
   - Code blocks become "Code block, N lines, skipped." (a setting can read them instead).
   - Inline code is read plainly.
   - File paths shrink to their last two segments.
   - URLs become "link".
   - List items become sentences.
   - Headings get a pause.

   Then split the text into sentence-aligned chunks of at most 250 characters.
5. **Playback mode A: Web Speech (on the phone).** A chunk queue with play, pause, resume, restart, stop, and read again, plus voice and rate settings. Handle iOS quirks:
   - The first `speak()` must follow a tap.
   - `resume()` can stall; if it does, cancel and re-speak the current chunk.
   - Always call `cancel()` before restarting.
6. **Playback mode B: PC-rendered audio.**
   - `apps/companion/scripts/tts.ps1` renders a WAV from a text file using `System.Speech` through `powershell.exe` (Windows PowerShell 5.1). It takes voice and rate parameters and has a list-voices option.
   - Cache the audio per answer.
   - The phone plays it in an `<audio>` element via the signed URL.
   - Register Media Session metadata (title = session name) and handlers for play, pause, seek backward, and seek forward, so lock-screen and AirPods controls work.
   - In CI, skip render tests if no voices are installed.
7. **Copy.**
   - "Copy to phone" uses the Clipboard API on tap.
   - "Copy to PC" has the companion write a temp file and run `Get-Content -Raw -Encoding UTF8 <file> | Set-Clipboard`.
8. **Auto-read setting.** Options: off (default), after a notification tap, or automatic.

### T4 — Talk half (`companion-core` + `phone-ui`)

The phone app uses:

- Vite + React + TypeScript
- a web manifest with `display: standalone`
- no service worker in the prototype (avoids stale caches)
- dark mode, a one-handed layout, and large tap targets

Screens and controls:

- **Sessions.** A list with status (idle, working, waiting for approval, or error), with the active session clearly highlighted. Include an "Attach existing thread" picker that uses `thread/list` filtered by the session's `cwd`.
- **Composer.** A large text box (the owner dictates with the iOS keyboard mic) and a Send button. Show the router's echo (e.g., "→ Kernel Labs: Run the tests.") and a confirm sheet when `needsConfirm` is set.
- **Skills.** A drawer populated from `skills/list` for the active session; tap to invoke.
- **Goal.** Show the current goal; set, pause/resume (if the installed version supports it), and clear.
- **Stop.** Interrupts the active turn.
- **Approvals.** Cards with the command or file summary and Approve / Decline buttons. Never auto-approve.
- **Answers.** The latest answers per session, with both playback modes and both copy buttons.
- **Settings.** Playback mode, voice, rate, auto-read, read code blocks, and paired device info.

### T5 — Shared terminals experiment (`shared-session-lab`)

1. **Start script.** `tools/shared-session/start-server.ps1` creates a capability-token file in the data dir and starts `codex app-server --listen ws://127.0.0.1:4500 --ws-auth capability-token --ws-token-file <absolute path>`, using the flags verified in T1.
2. **Two-client test.** `tools/shared-session/two-clients.ts` runs these steps:
   1. Client A starts a thread in a temp dir and runs a one-sentence turn.
   2. Client B resumes that thread.
   3. A starts a second tiny turn. Check that B receives the `agentMessage` `item/completed` and `turn/completed`.
   4. B starts a turn. Check that A observes it.

   Use at most 3 live turns. Record PASS/FAIL with redacted evidence in `docs/REPORT.md`.
3. **Manual version.** Add these steps to `docs/MANUAL_TESTS.md`:
   1. Attach a TUI with `codex --remote ws://127.0.0.1:4500 --remote-auth-token-env SULTI_CODEX_TOKEN`.
   2. Start a conversation.
   3. Attach to that thread from the phone and send a prompt.
   4. Confirm the TUI shows it live.

### T6 — Speech-to-text bench scaffold (`qa-security`, optional, last)

Create `tools/stt-bench/` with a README and a script. The script runs a locally installed whisper.cpp CLI over a folder of WAV recordings and a list of expected utterances. It reports latency and routing accuracy through the `packages/core` router.

The target machine is an Intel i5 12th gen with an NVIDIA RTX 3050 and 16 GB RAM. **Don't download models or binaries**; the owner does that.

### T7 — Integration, docs, push, report (orchestrator)

1. **Clean-clone check.** From a clean clone, run `npm ci && npm run build && npm run typecheck && npm test && npm run scan`.
2. **Architecture doc.** Write `docs/ARCHITECTURE.md` with a Mermaid diagram showing:
   - iPhone ⇄ Tailscale Serve ⇄ companion (7417)
   - companion ⇄ app-server (stdio), or the shared app-server (ws 4500)
   - terminals → Stop hook → companion (7418)
3. **Owner checklist.** Finalize `docs/MANUAL_TESTS.md` as an ordered list:
   1. Install Node LTS and confirm `codex --version`.
   2. Install Tailscale on the PC and iPhone. Enable MagicDNS and HTTPS certificates in the admin console. Run `tailscale serve --bg 7417` (verify the syntax with `tailscale serve --help`).
   3. Run `npm run build && npm start`. Open the `ts.net` URL on the iPhone, pair by QR code, and Add to Home Screen.
   4. Review and run `install-hook.ps1`, then restart the Codex terminals.
   5. Listen tests: both playback modes × Safari tab / Home Screen app × screen locked / AirPods.
   6. Talk tests across two sessions: prompts, skills, goals, stop, approvals.
   7. The shared-terminal test (T5 manual version).
   8. Optional: the STT bench.
4. **Final push.** Commit and push. Confirm CI is green and the repo is public.

## 6. Repo layout

```
sulti/
├─ apps/
│  ├─ companion/        Node + TS: servers, app-server manager, listen/, CLI, scripts/tts.ps1
│  └─ phone/            Vite + React + TS web app
├─ packages/
│  ├─ protocol/         generated Codex types + JSON-RPC client
│  └─ core/             wire contract, router, fuzzy matcher, speech-text (pure TS)
├─ scripts/hooks/       stop-hook.mjs, install-hook.ps1
├─ tools/               secret-scan.mjs, shared-session/, stt-bench/
├─ test/                fixtures/, mock-app-server/, integration/
└─ docs/
```

Ports (all on `127.0.0.1`):

- Phone server: `7417`
- Local control: `7418`
- Shared app-server: `4500`

## 7. Wire contract

Write this first, and validate it with zod on both sides.

**Phone → companion**

- `auth {deviceToken}`
- `sessions.list`
- `session.select {sessionId}`
- `utterance {text, sessionId?}`
- `route.confirm {routeId, accept}`
- `prompt.send {sessionId, text}`
- `skill.invoke {sessionId, skill, text?}`
- `goal.get {sessionId}`
- `goal.set {sessionId, objective}`
- `goal.update {sessionId, status}`
- `goal.clear {sessionId}`
- `turn.interrupt {sessionId}`
- `approval.respond {requestId, decision}`
- `answer.copyToPc {answerId}`
- `answer.audioUrl {answerId}`
- `thread.list {sessionId}`
- `thread.attach {sessionId, threadId}`

**Companion → phone**

- `auth.ok`
- `sessions {sessions[]}`
- `session.status {sessionId, status}`
- `answer {id, sessionId, turnId, text, speechText, createdAt, source}`
- `route.result {routeId, intent, echo, needsConfirm}`
- `skills {sessionId, skills[]}`
- `goal {sessionId, goal | null}`
- `approval.request {requestId, sessionId, kind, summary, command?, cwd?}`
- `approval.resolved {requestId}`
- `threads {sessionId, threads[]}`
- `audio.url {answerId, url}`
- `toast {level, message}`

## 8. Verification rules (every task)

- Write tests alongside code. No task is done until its tests pass.
- After each merge, run `npm run typecheck && npm test && npm run scan`, then commit and push.
- Keep `docs/REPORT.md` current: mark each Definition-of-Done item PASS, FAIL, or NEEDS-OWNER, with evidence.
- Log every non-obvious choice in `docs/DECISIONS.md`, one short entry each: decision, reason, alternative considered.

## 9. Test corpus (fictional names only)

Sessions:

- **Sole Harbor** (alias "soul harbor")
- **Lead Tracker** (alias "led tracker")
- **Kernel Labs** (alias "colonel labs")

Skills: `execute-plans`, `systematic-debugging`, `writing-tests`.

The active session is Sole Harbor unless the case says otherwise.

| Utterance (as dictated) | Expected result |
|---|---|
| "switch to soul harbor" | app → switch to Sole Harbor |
| "tell led tracker to investigate the checkout problem don't modify anything yet" | prompt → Lead Tracker: "Investigate the checkout problem. Don't modify anything yet." |
| "use execute planes" | codex → skill `execute-plans` on the active session |
| "use systematic de bugging to investigate the authentication issue" | codex → skill `systematic-debugging`, text "Investigate the authentication issue." |
| "set the goal to finish the authentication migration and make all tests pass" | codex → goal.set "Finish the authentication migration and make all tests pass." |
| "what's the current goal" | codex → goal.get |
| "pause the goal" / "resume the goal" / "clear the goal" | codex → goal.update / goal.update / goal.clear |
| "stop codex" | codex → interrupt the active turn |
| "read the response" / "read it again" / "pause" / "resume" / "start over" | app → playback read / again / pause / resume / restart |
| "copy the response" | app → copy (ask: phone or PC) |
| "run the tests" | prompt → active session: "Run the tests." (never a shell command) |
| "in colonel labs run the tests" | prompt → Kernel Labs: "Run the tests." |
| "approve" / "yes do it" | never approves; app → show pending approvals |
| "switch to bananas" | needsConfirm, or "No session named bananas" |

## 10. Final report (`docs/REPORT.md`)

1. Repo URL and visibility.
2. Definition-of-Done checklist with status and evidence.
3. Protocol differences found in T1.
4. T5 result and a recommendation: keep the terminals, or move to companion-owned sessions.
5. Owner next steps, in order.
6. Known risks, open questions, and the suggested next iteration.
