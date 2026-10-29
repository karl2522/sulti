# Sulti build report

Status as of 2026-10-29. Every agent-verifiable item in the Definition of Done passes. The four iPhone and terminal items need the owner and have step-by-step checklists in [MANUAL_TESTS.md](MANUAL_TESTS.md).

## 1. Repository

- **URL:** https://github.com/karl2522/sulti
- **Visibility:** **public**, confirmed through the `github-personal` GitHub MCP (`private: false`, default branch `main`). The same MCP created the repository in T0.
- **Topics:** not set, because the MCP has no topics tool (D6). Add `codex`, `voice`, `windows`, `iphone`, `pwa`, `typescript` from the repo page if you want them.

## 2. Definition of Done

### Agent-verifiable

| Item | Status | Evidence |
|---|---|---|
| Public repo `sulti` created through the GitHub MCP, default branch `main`, all work pushed, visibility confirmed via the MCP | PASS | Created with `github-personal` in T0. `search_repositories` returns `private: false`, and `list_commits` shows the pushed HEAD. |
| Clean clone on Windows: `npm ci`, `npm run build`, `npm run typecheck`, `npm test` | PASS | Fresh `git clone` of `857aa81` into a temp folder: `npm ci` exit 0, build exit 0, typecheck exit 0, **186 tests in 17 files** passed, `npm run scan` OK. Re-checked after this report was added (see the commit log). |
| Unit tests: intent router (full Section 9 corpus) | PASS | `packages/core/src/router.test.ts` (21 tests, every Section 9 row). `tools/stt-bench/bench.test.ts` also checks all 21 corpus phrases. |
| Unit tests: fuzzy matcher | PASS | `packages/core/src/fuzzy.test.ts` |
| Unit tests: final-answer extraction from recorded app-server fixtures | PASS | `apps/companion/src/turns.test.ts`, using `test/fixtures/app-server/*.jsonl`, which are shaped like the T1 live capture |
| Unit tests: speech-text normalizer | PASS | `packages/core/src/speech.test.ts`, plus the phone's chunk queue in `apps/phone/src/speechQueue.test.ts` |
| Unit tests: Stop-hook payload parsing | PASS | `test/hooks/stop-hook.test.ts` |
| Unit tests: pairing and auth | PASS | `apps/companion/src/security.test.ts`; `test/integration/companion.test.ts` covers pairing, the WebSocket auth timeout and 4401, and the Origin check |
| Unit tests: signed audio URLs | PASS | `apps/companion/src/security.test.ts` (signature, expiry, tampering, overlong lifetime) and the integration test (206 Range responses, 403 for tampered or unsigned links) |
| Integration tests against a mock app-server (JSONL over stdio), zero Codex usage | PASS | `test/integration/companion.test.ts` (23 tests) runs the real companion against `test/mock-app-server/server.mjs` |
| `npm run smoke:live` exists and passed once against real Codex | PASS | 2026-10-29: `PASS PONG final answer (kind=answer)` and `PASS interrupt after first delta (kind=interrupted)`, run as `smoke:live PASSED` with codex-cli 0.165.0 and 2 turns. The first attempts failed before any turn because the wrong `codex` copy was picked; that was fixed in `10bdfd5` (D10). |
| Two-client shared-session experiment (T5) ran and the result is recorded | PASS | See section 4 below. |
| `npm run scan` passes on every tracked file; `.gitignore` covers local data | PASS | `secret-scan: OK` on every commit and in the clean clone. `.gitignore` covers `node_modules/`, `dist/`, `coverage/`, `.sulti/`, `*.log`, `.env*`, `sessions.json`, `test/live-output/` and the stt-bench model and audio folders, and the scan refuses those file names. |
| GitHub Actions CI green: `windows-latest`, install, typecheck, tests with mocks | PASS | `.github/workflows/ci.yml` runs on `windows-latest` (Node 22): `npm ci`, scan, typecheck, build, `npm test` with `SULTI_CI=1`. Every pushed commit is green. |
| Docs exist | PASS | `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/PROTOCOL_NOTES.md`, `docs/MANUAL_TESTS.md`, `docs/REPORT.md`, `docs/BUILD_PROMPT.md` |

### Owner-verified

| Item | Status | Where |
|---|---|---|
| A 5-minute answer plays to the end with the screen locked, in both modes, as a Safari tab and as a Home Screen app | NEEDS-OWNER | MANUAL_TESTS sections 3 and 5 (the 8-row matrix) |
| Lock-screen and AirPods play/pause for PC-rendered audio | NEEDS-OWNER | MANUAL_TESTS section 5. Media Session metadata and play, pause, stop and ±15 s handlers are implemented in `apps/phone/src/usePlayer.ts`. |
| Prompts reach the right session across two projects; skills, goals, stop and approvals work | NEEDS-OWNER | MANUAL_TESTS section 6. The same flows pass against the mock in the integration tests and were exercised in a headless browser (below). |
| A terminal attached with `codex --remote` shows a turn started from the phone | NEEDS-OWNER | MANUAL_TESTS section 7. The underlying protocol behavior passed in T5. |

### Phone app checks done on the PC

The phone app was driven at iPhone size (390×844, touch) in headless Chromium against the real companion CLI running on the mock app-server, on spare loopback ports with a temp data folder. The walkthrough covered:

- pairing from the `/pair#code=` link, with the code dropped from the URL afterwards
- the session list with the active session highlighted, and the thread picker
- sending a prompt and seeing the routed echo and the answer card
- the skills sheet
- a fuzzy cross-session route
- settings
- **Mode B playback:** the PC rendered a real WAV with `System.Speech`, the phone received a signed URL, and the now-playing bar showed PC audio

The browser console had no errors, and the device token was stored only in localStorage. Screenshots stayed local (`test/live-output/`, gitignored).

### Live Codex usage

The build prompt caps live use at 8 turns.

| Use | Turns |
|---|---|
| Before this phase: T1 app-server capture and the live Stop-hook checks | 3 |
| `smoke:live` (passing run) | 2 |
| An interrupted `smoke:live` attempt (the environment aborted the command; whether it reached Codex can't be proven, so it is counted) | up to 2 |
| T5 two-client run | 1 |
| **Total** | **6 confirmed, at most 8** |

The T5 run left one persisted lab thread ("Write the numbers one to forty…") in a temp folder in your Codex history. You can archive it.

## 3. Protocol differences found in T1 (and later)

Full details are in [PROTOCOL_NOTES.md](PROTOCOL_NOTES.md).

- **Generated types.** Generated TypeScript imports have no file extensions; the generator script rewrites them for NodeNext.
- **Approval policy.** There's no `on-failure` value. The values are `untrusted`, `on-request`, `never`, or a granular object.
- **Text input.** `turn/start` text inputs need `text_elements: []`, and `turn/interrupt` needs both `threadId` and `turnId`.
- **Final answer.** The `final_answer` phase is only on `item/completed`; `item/started` has `phase: null`.
- **Goals.** Ephemeral threads reject goal calls, so Sulti uses persisted threads. Pause and resume are `thread/goal/set {status}` without an objective, and `origin: "user"` is sent for phone actions.
- **Approvals.** `serverRequest/resolved` follows every approval answer; Sulti uses it to clear cards.
- **Unsandboxed methods.** `process/*` exists only as notifications in 0.165.0. `thread/shellCommand` and `command/exec*` are unreachable anyway, because of the 13-method allowlist.
- **Stop hook.**
  - Hooks are a stable feature, on by default.
  - The payload arrives on stdin, and the field names are confirmed live.
  - User hooks **must be trusted with `/hooks`** before they run.
  - On Windows, the command must not start with a quoted path. The installer uses an unquoted node path, with an 8.3 short path when it contains spaces.
  - `async = true` works.
- **Shared mode.** The bearer token is enforced (401). A thread can't be resumed before its first turn ("no rollout found"). A client that resumes mid-turn gets the rest of the turn live, and receives a `deprecationNotice` after resuming.
- **Multiple Codex installs.** The desktop app ships an older `codex.exe` (0.140) that can't parse the current config. Sulti resolves `codex` in PATH order like `cmd.exe` (D10).

## 4. T5: shared terminals

**Result: PASS**, in the one-turn variant (`node tools/shared-session/two-clients.ts --turns 1`). The run started its own `codex app-server --listen ws://127.0.0.1:4513 --ws-auth capability-token --ws-token-file <temp>`. Redacted output:

```text
PASS  A connects with the capability token  (initialize ok)
PASS  a client without the token is refused  (refused: Unexpected server response: 401)
PASS  A starts a persisted thread  (thread 01a186a7…)
PASS  B resumes the thread while A's turn runs  (ok, turn still running: true)
PASS  B observes the rest of A's turn live  ({"itemCompleted":true,"turnCompleted":true})
T5 PASSED (1 live turn)
```

A free dry run (`--turns 0`) showed that B can't resume before the first turn (`no rollout found`). The full spec order (A turn, B resume, A turn seen by B, B turn seen by A) is implemented as `--turns 3` but wasn't run, to stay under the 8-turn cap (D16). The server routes a thread's notifications to every subscribed client, so the B-to-A direction relies on the same mechanism. The manual TUI test in section 7 of MANUAL_TESTS checks that direction with a real terminal.

**Recommendation: keep the terminals as they are, and keep companion-owned sessions as the default for talking from the phone. Make shared mode an opt-in for projects where live mirroring matters.**

- **Listening already works without changing how you start Codex.** The Stop hook delivers every terminal's final answer, including from folders Sulti doesn't manage.
- **Shared mode has real constraints.**
  - Every terminal must be started with `codex --remote` and a token.
  - A thread can be attached only after its first turn.
  - Every client sees every approval request; Sulti stays silent on threads it doesn't own (D11).
  - Codex still calls the WebSocket transport experimental.
- **It does deliver what it promises.** A phone-started turn shows live in the same thread. If the manual TUI test (section 7) feels good, use `"mode": "shared"` for one or two projects and revisit once the transport is stable.

## 5. Owner next steps, in order

Follow [MANUAL_TESTS.md](MANUAL_TESTS.md). In short:

1. `npm ci`, copy `sessions.example.json` to `%APPDATA%\sulti\sessions.json`, and list your projects with aliases for words the keyboard mishears.
2. **Tailscale.** Enable MagicDNS and HTTPS, then run `tailscale serve --bg 7417` (check the syntax with `tailscale serve --help`).
3. `npm run build`, then `npm start`. Pair in Safari, add to the Home Screen, and pair again there, because Home Screen apps have their own storage.
4. Review and run `scripts\hooks\install-hook.ps1`, restart your terminals, and **trust the hook with `/hooks`**.
5. Run the listen matrix. This is the key open question: does a locked screen stop playback in mode A, mode B, or both?
6. Run the talk tests across two projects, including a Decline and an Approve.
7. Optionally, the shared-terminal test.
8. Optionally, the speech-to-text bench.
9. Add topics on GitHub, and choose a license when you're ready.

## 6. Risks, open questions and next iteration

**Risks**

- **Background audio on iOS.** This is the biggest unknown and is why there are two modes. If both stop on lock in the Home Screen app, a native wrapper is the fallback, or playing as a Safari tab.
- **Codex protocol drift.** The app-server API moves quickly; this build is verified against 0.165.0. `npm run gen:protocol` regenerates the types, and the method allowlist keeps new unsandboxed methods out by default.
- **The shared WebSocket transport is experimental.** Mode `stdio` is the default for that reason.
- **Hook trust is per hash.** Reinstalling the hook, or changing node versions (which changes the command), needs `/hooks` again. Until then terminals are silently not heard.
- **Dictation errors** route to the wrong place. Mitigations are aliases, fuzzy matching with confirm thresholds, the echo line, and the confirm sheet. The STT bench measures how often this happens with a local engine.

**Open questions**

- Can Windows `System.Speech` voices be good enough for long answers, or should mode B use a neural TTS engine?
- Is a goal's automatic continuation something the phone should surface, for example notifying when a goal completes?

**Suggested next iteration**

- Push notifications when an answer arrives while the app is closed. This needs a service worker and Web Push, which iOS supports for Home Screen apps.
- Local speech-to-text on the PC (whisper.cpp server) with push-to-talk on the phone, if the bench shows good accuracy and latency.
- A per-session answer history view and search.
- Signed release builds plus a small installer for the companion.
