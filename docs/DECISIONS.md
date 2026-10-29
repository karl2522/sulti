# Decisions

One short entry per non-obvious choice: decision, reason, alternative considered.

## D1. npm workspaces with four packages

- **Decision:** `packages/core`, `packages/protocol`, `apps/companion`, `apps/phone` as npm workspaces.
- **Reason:** the build prompt's layout; npm ships with Node so there is nothing extra to install.
- **Alternative:** pnpm workspaces (faster, but one more tool for the owner).

## D2. TypeScript 7 native compiler, pinned

- **Decision:** `typescript@7.0.2` (the current `latest` tag), exact version.
- **Reason:** current stable release; fast typechecks on Windows.
- **Alternative:** `typescript@6.0.3` if the native compiler shows an incompatibility.

## D3. Typecheck against sources, build per package

- **Decision:** `npm run typecheck` uses one root `tsconfig.json` with `paths` pointing at package sources (plus the phone's own config). `npm run build` compiles each package to `dist/` in dependency order.
- **Reason:** one fast typecheck pass; runtime imports still resolve through normal workspace links.
- **Alternative:** TypeScript project references (`tsc -b`), more config for little gain at this size.

## D4. Orchestration ran sequentially in one agent

- **Decision:** the workstreams in the build prompt (protocol-scout, qa-security, companion-core, listen, phone-ui, shared-session-lab) were executed sequentially by the orchestrator, in the prompt's order, each against the ownership boundaries listed there.
- **Reason:** every workstream shares the wire contract and the mock app-server; running them in one context avoided merge churn and kept Codex usage (which costs the owner's plan) under tight control.
- **Alternative:** up to four parallel subagents, as the prompt allows.

## D5. Secret scan covers tracked and untracked-but-not-ignored files

- **Decision:** `tools/secret-scan.mjs` scans the output of `git ls-files --cached --others --exclude-standard`.
- **Reason:** catches secrets before the first `git add`, not only after.
- **Alternative:** scanning only `git ls-files` (tracked), which misses new files.

## D6. Repo topics not set

- **Decision:** the repository has no topics.
- **Reason:** the connected GitHub MCP (`github-personal`) has no topics or repo-update tool, and the prompt says "if supported".
- **Alternative:** a direct REST call with the PAT; the owner can also add them in one click from the repo page.

## D7. Method allowlist inside the JSON-RPC client

- **Decision:** `AppServerClient.request()` only sends 13 allowlisted methods and refuses everything else, with an extra explicit check for `thread/shellCommand`, `command/exec*` and `process/*`.
- **Reason:** makes "no phone-triggered path reaches an unsandboxed method" true by construction, not by code review.
- **Alternative:** a denylist, which silently allows new dangerous methods in future Codex versions.

## D8. Stop hook runs async with a short timeout

- **Decision:** the installer writes the Stop hook with `async = true` and `timeout = 5`.
- **Reason:** Codex docs say async hooks run in the background and can't control the turn, which is exactly an observer. The hook script also prints nothing and exits 0.
- **Alternative:** a synchronous hook, which blocks every turn for up to the HTTP timeout when the companion is down.
- **Evidence:** verified live on Windows with Codex 0.165.0. A `command_windows` hook with `async = true` ran after the turn without delaying it and posted the answer to the companion (`docs/PROTOCOL_NOTES.md`, "Stop hook, verified live").

## D9. Fixtures are hand-built from one live capture

- **Decision:** one live turn ("Reply with only the word PONG.") was captured to learn the exact event shapes; the six committed fixtures are hand-built in that shape with fictional content.
- **Reason:** keeps Codex usage to one turn, and real captures contain MCP server names, paths and account details that must not be published.
- **Alternative:** capturing all five scenarios live (about five turns and heavy redaction).

## D10. How the companion finds `codex` on Windows

- **Decision:** `resolveExecutable` (`apps/companion/src/spawn.ts`) walks PATH the way `cmd.exe` does. It checks directories in order, and within one directory it tries `.exe` before `.cmd` and `.bat`. The binary it finds is launched in one of three ways:
  - A native `.exe` runs directly.
  - An npm `.cmd` shim with `node_modules/@openai/codex/bin/codex.js` next to it runs as `node codex.js`, using the `node.exe` beside the shim when there is one, so it never goes through `cmd.exe`.
  - Any other `.cmd` or `.bat` goes through `cmd /d /s /c`, with each argument quoted for `CommandLineToArgvW` and cmd metacharacters caret-escaped twice, because the batch file re-parses `%*`.
  
  The copy bundled with the Codex desktop app is a last resort, and `SULTI_CODEX_PATH` overrides everything.
- **Reason:** since the CVE-2024-27980 fix, Node refuses to spawn `.cmd` files without a shell, and `shell: true` string concatenation is an injection risk. The search order matters too. The first version searched every directory for an `.exe` first, which picked an older desktop-app copy (0.140) later on PATH over the npm CLI (0.165) that the owner actually runs. That made `smoke:live` fail with a config parse error.
- **Alternative:** always launch through `cmd.exe`, which has fragile quoting and opens a console window.

## D11. Shared mode leaves other clients' approvals alone

- **Decision:** with a shared app-server, approval requests for threads the companion doesn't track get no response from the companion (`NO_RESPONSE`).
- **Reason:** every client attached to a shared server receives every server request. The TUI that owns the thread must be the one that answers. Declining from the companion would cancel the owner's action at the keyboard.
- **Alternative:** forward every approval to the phone, which races with the terminal.

## D12. Unlisted sessions are listen-only

- **Decision:** a Stop-hook answer from a folder not in `sessions.json` creates an "unlisted" session named after the folder. The phone shows its answers, but hides the composer, skills, goal and Stop, and the hub refuses prompts to it.
- **Reason:** the owner explicitly chooses which projects can be driven from the phone. Listening is harmless; sending is not.
- **Alternative:** auto-registering every folder as a full session.

## D13. PC audio is a 16 kHz mono WAV with Range support

- **Decision:** `tts.ps1` renders with `System.Speech` through Windows PowerShell 5.1 to a 16 kHz, 16-bit mono WAV, cached per answer. The phone fetches it with a signed URL that lasts 10 minutes, and the server supports HTTP Range requests.
- **Reason:** Safari requires Range support for `<audio>` seeking and lock-screen scrubbing. Speech at 16 kHz is about 1.9 MB per minute, which is fine over Tailscale, and needs no encoder dependency.
- **Alternative:** MP3 or AAC encoding, which needs ffmpeg or a native module.

## D14. Who runs a routed intent

- **Decision:** the companion runs Codex intents and prompts, and it switches sessions only when the router resolved a session id. Playback, copy and show-approvals run on the phone, because they act on the phone's player and clipboard. When `needsConfirm` is set, nothing runs until the phone sends `route.confirm`. An unresolved "switch to …" opens the session picker instead (`apps/phone/src/routePlan.ts`).
- **Reason:** each action runs where its state lives. The confirm step keeps a misheard command from reaching Codex.
- **Alternative:** running everything on the companion and pushing playback commands to the phone, which needs another message type for no gain.

## D15. Phone app: no service worker, explicit taps for audio

- **Decision:** the phone app has a manifest (`display: standalone`) but no service worker. Speech and audio always start from a tap. "Automatic" auto-read starts only after the first tap in the app. Mode B asks the PC to render the newest answer in advance, so Play starts immediately.
- **Reason:** a service worker makes stale builds likely during a prototype. iOS blocks `speechSynthesis.speak()` and `audio.play()` without a user gesture.
- **Alternative:** a cached offline shell with update prompts.

## D16. The T5 live run uses one model turn

- **Decision:** `two-clients.ts` supports the full three-turn plan (`--turns 3`), but the recorded run used `--turns 1`. A starts the thread and its only turn, B resumes while that turn is running, and B must receive the rest of it live.
- **Reason:** the build prompt caps live Codex use at 8 turns in total. One `smoke:live` attempt was interrupted by the environment, and whether it reached Codex can't be proven, so it is counted as 2 turns. That left one turn for T5. A free dry run (`--turns 0`) showed that a thread can't be resumed before its first turn, so the second client has to join mid-turn.
- **Alternative:** the full three-turn run, which the owner can do with `node tools/shared-session/two-clients.ts --turns 3`.
