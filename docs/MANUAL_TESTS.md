# Manual tests (owner)

These steps need your iPhone, your Codex terminals and your Tailscale account, so the build couldn't run them. Do them in order. Tick each box, and note anything that fails in `docs/REPORT.md` or an issue.

Live Codex turns cost your plan. Every step that starts one says so.

## 1. Prerequisites

- [ ] Install Node.js LTS (22 or newer) and check it: `node --version`.
- [ ] Check `codex --version`. Sulti was built and verified against `codex-cli 0.165.0`. If several copies are installed, Sulti uses the first `codex` on PATH, the same one `cmd.exe` would run.
- [ ] In the repo: `npm ci`.
- [ ] Copy `apps/companion/sessions.example.json` to `%APPDATA%\sulti\sessions.json`, then edit it to list your real projects. Each entry needs a `name` and a `cwd`. Add an `aliases` entry for any word the iOS keyboard mishears, such as "led tracker". You can also set `sandbox` and `approvalPolicy`. This file stays on your PC and is gitignored.

## 2. Tailscale (one-time)

- [ ] Install Tailscale on the PC and the iPhone, and sign both into the same tailnet.
- [ ] In the Tailscale admin console, enable **MagicDNS** and **HTTPS certificates**.
- [ ] Proxy the phone server: `tailscale serve --bg 7417`. The `serve` syntax has changed between Tailscale versions, so run `tailscale serve --help` first. On some versions the form is `tailscale serve --bg http://127.0.0.1:7417` or `tailscale serve https / http://127.0.0.1:7417`. Proxy **7417 only**. Never proxy 7418 (local control) or 4500 (shared app-server).
- [ ] Check with `tailscale serve status`. It should show `https://<pc>.<tailnet>.ts.net` forwarding to `127.0.0.1:7417`.
- [ ] Optional: set `"publicUrl": "https://<pc>.<tailnet>.ts.net"` in `%APPDATA%\sulti\config.json`, using `apps/companion/config.example.json` as a template. If it's missing, the companion reads the URL from `tailscale status`. The phone's origin must match it exactly, or the WebSocket is refused.

## 3. Build, start and pair

- [ ] Build **before** starting: `npm run build`. This also builds the phone app. Without `apps/phone/dist`, the companion answers 503 instead of serving the app.
- [ ] Start the companion: `npm start`. It prints the phone server address, your sessions, and a pairing link with a QR code. Leave the window open.
- [ ] On the iPhone, scan the QR code, or open the link in Safari. The page should say **Pair this phone**. Tap **Pair**, and the Talk screen appears with a green dot.
- [ ] Add to Home Screen: Share, then **Add to Home Screen**, then open Sulti from the icon. **iOS gives Home Screen apps their own storage**, so the app asks to pair again. Press Enter in the companion window (or run `npm run pair` in a second terminal), tap **I have a code**, and type the code.
- [ ] Check that both devices are listed: `npm run devices -- list`. To revoke one, run `npm run devices -- revoke <id>` and restart the companion. That phone should show **Not paired yet**.

## 4. Stop hook (listen to your existing terminals)

- [ ] Review the hook script `scripts/hooks/stop-hook.mjs` and the installer `scripts/hooks/install-hook.ps1`.
- [ ] Preview the change: `powershell -ExecutionPolicy Bypass -File scripts\hooks\install-hook.ps1 -DryRun`.
- [ ] Install it: the same command without `-DryRun`. It backs up `config.toml` first, and running it again replaces the block. `-Uninstall` removes it.
- [ ] Restart your Codex terminals.
- [ ] **Trust the hook.** In a Codex terminal, run `/hooks`, find the Sulti Stop hook and trust it. Codex skips untrusted hooks silently. Trust is tied to the hook's hash, so trust it again after reinstalling.
- [ ] Finish one small turn in a terminal *(1 live turn)*. The answer should appear on the phone within a second or two, labelled "terminal". A folder that isn't in `sessions.json` shows up as a listen-only session named after the folder.
- [ ] If nothing arrives, check `%APPDATA%\sulti\hook-errors.log`, which never contains message text. Then run the hook once by hand with `--debug` to save the raw payload in the data folder and compare field names with `docs/PROTOCOL_NOTES.md`.

## 5. Listen tests

Get one long answer first *(1 live turn)*. In any session, ask for something that takes about 5 minutes to read, for example "Explain how our build works in about 800 words". Then run each combination below, letting the answer play **to the end**.

| Mode | Where | Screen | Result |
|---|---|---|---|
| A, phone voice | Safari tab | on | [ ] |
| A, phone voice | Safari tab | locked | [ ] |
| A, phone voice | Home Screen app | on | [ ] |
| A, phone voice | Home Screen app | locked | [ ] |
| B, PC audio | Safari tab | on | [ ] |
| B, PC audio | Safari tab | locked | [ ] |
| B, PC audio | Home Screen app | on | [ ] |
| B, PC audio | Home Screen app | locked | [ ] |

Switch modes in **Settings > Playback**. For each one, note whether playback stopped, where, and whether **Resume** in the app recovered it. Mode A can pause on lock; that's the known iOS limitation Mode B exists for.

- [ ] **Mode B lock screen.** The lock screen shows the session name with play/pause and ±15 s skip, and each control works.
- [ ] **Mode B AirPods.** Play/pause from AirPods works, both with the screen on and locked.
- [ ] **Mode A controls.** Pause, Resume, Start over (↺) and Stop (■) in the bar all work. Change the voice and speed in Settings, then tap **Test voice**.
- [ ] **Read code blocks.** With it off, a code block is announced as "Code block, N lines, skipped." With it on, the code is read.
- [ ] **Auto-read "After a tap".** A new answer shows a "▶ New answer from …" banner, and tapping it plays the answer.
- [ ] **Auto-read "Automatic".** After you've tapped anything in the app once, new answers start reading on their own.
- [ ] **Copy on phone** puts the answer on the iPhone clipboard. **Copy to PC** puts it on the Windows clipboard.

## 6. Talk tests (two sessions)

Use two configured sessions, for example the first two in your `sessions.json`. Each prompt below costs a live turn *(about 8 to 10 turns in total)*. Dictate with the iOS keyboard microphone into the composer, then tap **Send**. The line above the box shows how Sulti understood you, for example "→ Kernel Labs: Run the tests."

- [ ] **Switching sessions.** "switch to <session 2>" switches sessions, and the header and **Sessions** tab mark it active. Do it once with a misheard alias.
- [ ] **Prompts.** "tell <session 1> to summarize the README in two sentences" lands in session 1, even while session 2 is active. Its answer arrives and plays.
- [ ] **Prompt cleanup.** "in <session 2> list the top-level folders" is sent to session 2 as a cleaned-up sentence.
- [ ] **Unclear session.** "switch to bananas" doesn't switch. You're asked to pick a session.
- [ ] **Skills.** **Skills** lists that project's skills. Tapping one sends it, together with any text in the box. Also dictate "use <skill name>".
- [ ] **Goals.** Use **Set goal** with a small objective. **Pause** and **Resume** change the status pill, and **Clear** removes the goal. Repeat by voice: "what's the current goal", "pause the goal", "resume the goal", "clear the goal". A goal can start turns on its own, so clear it when you're done.
- [ ] **Stop.** Start a long prompt, then tap **Stop**, or say "stop codex". The turn ends as interrupted, and a toast says the session stopped.
- [ ] **Approvals.** In a session with `approvalPolicy: "on-request"` and `sandbox: "read-only"`, ask for something that needs permission, such as "create a file named sulti-check.txt". An approval card appears with the command or file summary. Tap **Decline** first and check that nothing changed. Then repeat and tap **Approve**.
- [ ] **Voice never approves.** With a card showing, saying "approve" or "yes do it" only scrolls to the approvals. It never answers them.
- [ ] **Attach an existing thread.** On **Sessions**, tap the active session, then **Show threads for this folder**, and pick one. New prompts continue that thread.
- [ ] **Recovery.** Kill the companion and start it again. The phone shows "Offline, retrying…", then reconnects on its own.

## 7. Shared terminals (T5, manual version)

This puts a terminal and the phone on the same live thread. The WebSocket transport is experimental in Codex.

- [ ] Start the shared server: `powershell -ExecutionPolicy Bypass -File tools\shared-session\start-server.ps1`. It creates `%APPDATA%\sulti\app-server-token` once and listens on `ws://127.0.0.1:4500`.
- [ ] Set `"mode": "shared"` in `%APPDATA%\sulti\config.json` and restart the companion with `npm start`. The defaults already point at port 4500 and that token file.
- [ ] In a new terminal, in one of your session folders:

  ```powershell
  $env:SULTI_CODEX_TOKEN = Get-Content "$env:APPDATA\sulti\app-server-token" -Raw
  codex --remote ws://127.0.0.1:4500 --remote-auth-token-env SULTI_CODEX_TOKEN
  ```

- [ ] Start a conversation in that TUI and let one turn finish *(1 live turn)*. A thread can't be attached before its first turn ("no rollout found").
- [ ] On the phone, go to **Sessions**, select that session, tap **Show threads for this folder**, and attach the TUI's thread.
- [ ] Send a short prompt from the phone *(1 live turn)*. **The TUI shows the prompt and the answer live**, and the phone receives the answer.
- [ ] Optional: send a prompt from the TUI. The phone receives the answer.
- [ ] When you're done, set `"mode": "stdio"` again and stop the shared server.

## 8. Optional: speech-to-text bench

- [ ] Follow `tools/stt-bench/README.md`. Record the phrases in `utterances.tsv` as 16 kHz mono WAVs, install a whisper.cpp CUDA build and a model, and run the bench in server mode. Add the routing accuracy and median latency to `docs/REPORT.md`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| The page shows "503" | The phone app isn't built. Run `npm run build`, then restart the companion. |
| Pairing works, but the dot stays red | `publicUrl` doesn't match the address in Safari, or Tailscale Serve points at the wrong port. |
| The app returns to "Not paired yet" | The device was revoked, or the Home Screen app has its own storage. Pair again. |
| PC audio says the link expired | Audio links last 10 minutes. Tap Play on the answer again. |
| `npm start` says a port is in use | Another companion is running. Close it, or change `port` and `hookPort` in `config.json`. |
| No voices in Mode B | Windows has no `System.Speech` voices installed. Add one under Settings > Time & language > Speech. |
