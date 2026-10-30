# Manual tests (owner, on the iPhone)

`npm run e2e` already drives every screen and flow in Chromium and WebKit, and `npm run e2e:live` checks real Codex through Cloudflare. This list covers what only a real iPhone can show: dictation, the iOS speech engine, lock-screen audio, AirPods, the Home Screen app and mobile networks. Do it once after deploying ([DEPLOY.md](DEPLOY.md)) and after any change to playback or the connection.

Steps marked *(live turn)* use your Codex plan.

## 1. Pair

- [ ] Run `npm run pair` on the PC and open the link in Safari on the iPhone. The code on the phone matches the PC. Tap **Connect**; the Sessions screen shows your PC's name with a green dot.
- [ ] **Share**, **Add to Home Screen**, open Sulti from the icon. It opens full screen and asks to pair again, because Home Screen apps have their own storage. Run `npm run pair`, type the code (with or without the dash), tap **Connect**.
- [ ] `npm run devices -- list` shows both.

## 2. Listen

Get one long answer first *(live turn)*: "Explain how our build works in about 600 words". Then play it in each combination, to the end.

| Voice | Where | Screen | Result |
|---|---|---|---|
| Phone voice | Safari | on | [ ] |
| Phone voice | Home Screen app | on | [ ] |
| Phone voice | Home Screen app | locked | [ ] |
| PC voice | Safari | on | [ ] |
| PC voice | Home Screen app | on | [ ] |
| PC voice | Home Screen app | locked | [ ] |

Switch voices with the chip in the player or in **Settings**. The phone voice may pause when the screen locks; that's an iOS limit and the reason PC voice exists.

- [ ] **Lock screen (PC voice).** Shows the session name with play/pause and 15-second skips, and each works.
- [ ] **AirPods (PC voice).** Play/pause from the AirPods works with the screen on and locked.
- [ ] **Reader.** The sentence being read is highlighted and stays in view; tapping a sentence jumps there; previous/next sentence, start over, stop and speed all work.
- [ ] **Session rows.** Play from a row on Sessions and from **Latest answer** on a session page: the ring fills, pause/resume works, and the stop button stops it.
- [ ] **Read automatically** (Settings): after you've tapped anything once, a new answer starts reading on its own.
- [ ] **Copy.** "Copy on this phone" fills the iPhone clipboard; "Copy to the PC clipboard" fills the Windows one.

## 3. Talk by dictation

Use the mic key on the iOS keyboard in the message box. Each send is a *live turn*.

- [ ] "tell <session> to summarize the README in two sentences" goes to that session even if another is active, and the "Sulti will send" card showed it before you sent.
- [ ] Say a session name the keyboard mishears (add it to `aliases` in `sessions.json` if needed). The card shows "heard as".
- [ ] "switch to <session>" moves the **Active** tag; "switch to bananas" asks you to pick.
- [ ] Paste a multi-line stack trace and send it. Codex receives the line breaks unchanged.
- [ ] While Codex works, send a follow-up. The card says it joins the current turn, and Codex picks it up.
- [ ] **Stop turn** on the session page ends a long turn.
- [ ] `/new` starts a fresh chat; the **Chat** card lets you go back to the previous one.

## 4. Approvals

- [ ] In a `read-only` session, ask "create a file named sulti-check.txt" *(live turn)*. The approval sheet opens with the command. **Decline**: nothing is created.
- [ ] Ask again and say "approve" into the message box. It only opens the approvals; nothing is approved. Then tap **Approve once**.

## 5. Your own terminals (Stop hook)

- [ ] Install and trust the hook (`scripts\hooks\install-hook.ps1`, then `/hooks` in a Codex terminal).
- [ ] Finish a turn in a terminal *(live turn)*. Within a few seconds the answer shows on the phone as "From a terminal". A folder that isn't in `sessions.json` appears as a listen-only session, and it's still listed after the companion restarts.

## 6. Connection

- [ ] Lock the phone for 10 minutes with the app open, then unlock. It reconnects by itself within a few seconds (no "Can't reach your PC" that stays).
- [ ] Switch the phone from Wi-Fi to mobile data while connected. It recovers.
- [ ] Restart the companion (`Stop-ScheduledTask 'Sulti companion'; Start-ScheduledTask 'Sulti companion'`). The phone shows "Can't reach your PC", then reconnects.
- [ ] Revoke the phone (`npm run devices -- revoke <id>`). Within 30 seconds it returns to "Connect this phone". Pair it again afterwards.

## 7. Optional: shared terminals

A terminal and the phone on the same live chat. Codex's WebSocket transport is experimental.

- [ ] Start the shared server: `powershell -ExecutionPolicy Bypass -File tools\shared-session\start-server.ps1`. It creates `%APPDATA%\sulti\app-server-token` once and listens on `ws://127.0.0.1:4500`.
- [ ] Set `"mode": "shared"` in `%APPDATA%\sulti\config.json` and restart the companion.
- [ ] In a new terminal, in one of your session folders:

  ```powershell
  $env:SULTI_CODEX_TOKEN = Get-Content "$env:APPDATA\sulti\app-server-token" -Raw
  codex --remote ws://127.0.0.1:4500 --remote-auth-token-env SULTI_CODEX_TOKEN
  ```

- [ ] Let one turn finish there *(live turn)*, then on the phone open that session's **Chat** card and pick the terminal's chat.
- [ ] Send a short prompt from the phone *(live turn)*. The terminal shows it and the answer live.
- [ ] Afterwards set `"mode": "stdio"` again and stop the shared server.

## 8. Optional: speech-to-text bench

- [ ] Follow `tools/stt-bench/README.md` and add the routing accuracy and latency to `docs/REPORT.md`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| The page shows "503" | The phone app isn't built. Run `npm run build` and restart the companion. |
| Cloudflare error 1033 | The tunnel is down: `cloudflared` isn't running, or the PC is off or asleep. |
| Cloudflare error 502 | The tunnel is up but the companion isn't. Check `%APPDATA%\sulti\companion.log`. |
| Pairing works, but "Can't reach your PC" stays | `publicUrl` in `config.json` doesn't match the address in Safari exactly. |
| A challenge page or the app never connects | Bot Fight Mode or a WAF rule is challenging the hostname. Turn it off for `trysulti`. |
| The app returns to "Connect this phone" | The device was revoked, or the Home Screen app has its own storage. Pair again. |
| "Too many attempts. Wait a minute." | Five wrong codes from this phone in a minute. Wait, then use a fresh code. |
| PC audio says the link expired | Audio links last 10 minutes. Tap play again. |
| `npm start` says Sulti is already running | The background task is running. Use it, or stop it first. |
| No PC voice | Windows has no `System.Speech` voices. Add one under Settings, Time & language, Speech. |
