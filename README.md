# Sulti

Sulti (Cebuano for "speak") is a voice-first iPhone remote for Codex sessions running on a Windows PC. It reads complete Codex answers aloud, and it routes what you dictate to the right project session: switch projects, send prompts, run skills, manage goals, stop turns and approve actions, without going back to the keyboard.

**Status:** ready to deploy. Unit and integration tests, a browser walkthrough of every phone flow in Chromium and WebKit, and a live run with real Codex behind a Cloudflare tunnel all pass. The checks only an iPhone can do (lock screen, AirPods, dictation) are an owner checklist in [docs/MANUAL_TESTS.md](docs/MANUAL_TESTS.md).

## How it works

A small **companion** runs on your PC. It drives `codex app-server` for the projects you list, and it also receives the finished answers from your existing Codex terminals through a Stop hook. It serves the **phone app**, which you open on your iPhone at a permanent HTTPS address through a Cloudflare Tunnel (production: `https://trysulti.jaredomen.com`, see [docs/DEPLOY.md](docs/DEPLOY.md)) or, privately, through Tailscale Serve.

- **Listen.** Every finished answer appears on the phone and can be read aloud. The phone can speak it with its own voice, or play audio rendered on the PC, which keeps working on the lock screen and with AirPods controls. Code blocks are summarized, and paths and links are shortened for speech.
- **Talk.** Dictate with the iOS keyboard microphone. "tell lead tracker to investigate the checkout problem", "use systematic debugging", "set the goal to …", "stop codex", "read it again". Sulti shows how it understood you, asks when it isn't sure, and never runs shell commands itself. "Run the tests" becomes a Codex prompt.
- **Approvals** show up as cards. Only a tap approves; saying "approve" just shows the cards.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the diagram and the security model.

## Quick start

You need Windows 10 or 11, Node.js 22+, the Codex CLI (`codex --version`, tested with 0.165.0), and a way for the iPhone to reach the PC over HTTPS: a Cloudflare Tunnel ([docs/DEPLOY.md](docs/DEPLOY.md)) or Tailscale on both devices.

```powershell
npm ci
New-Item -ItemType Directory -Force "$env:APPDATA\sulti" | Out-Null
Copy-Item apps\companion\sessions.example.json "$env:APPDATA\sulti\sessions.json"   # then list your projects
npm run build        # builds the companion and the phone app
# expose 127.0.0.1:7417 over HTTPS: Cloudflare Tunnel (docs/DEPLOY.md) or: tailscale serve --bg 7417
npm start            # prints a pairing link and QR code
```

Open the pairing link on the iPhone, tap **Connect**, then **Add to Home Screen**. To hear your existing terminals too, review and run `scripts\hooks\install-hook.ps1`, restart your terminals and trust the hook with `/hooks`. For the always-on setup at `https://trysulti.jaredomen.com`, follow [docs/DEPLOY.md](docs/DEPLOY.md).

## Commands

| Command | What it does |
|---|---|
| `npm start` | Start the companion (phone server on `127.0.0.1:7417`, local control on `127.0.0.1:7418`) |
| `npm run pair` | Print a new one-time pairing link from the running companion |
| `npm run devices -- list` / `revoke <id>` | Manage paired phones |
| `npm run build` / `typecheck` / `test` | Build, typecheck, and run the tests (mocks only, no Codex usage) |
| `npm run scan` | Secret scan over every tracked file |
| `npm run smoke:live` | Two tiny real Codex turns (costs your plan) |
| `npm run e2e` | Every phone flow in Chromium and WebKit against a mock Codex (needs `npx playwright-core install chromium webkit` once) |
| `npm run e2e:live` | Real Codex behind a temporary Cloudflare tunnel, in a throwaway data folder (two short turns) |
| `npm run dev:phone` | Phone app dev server on `127.0.0.1:5173`, proxying to a running companion |

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Deploying on Cloudflare](docs/DEPLOY.md)
- [Decisions](docs/DECISIONS.md)
- [Protocol notes](docs/PROTOCOL_NOTES.md), meaning what the installed Codex actually does
- [Manual tests](docs/MANUAL_TESTS.md), the owner checklist
- [Report](docs/REPORT.md), covering status, evidence and next steps
- [Build prompt](docs/BUILD_PROMPT.md), the original specification

## Privacy and safety

Sulti has no server of its own and no telemetry. Every listener binds to `127.0.0.1`, and Sulti never reads your Codex credentials. Your sessions, paired devices, answers and audio live in `%APPDATA%\sulti`, which is never committed. The phone talks only to your companion, and your companion talks only to Codex. Behind a Cloudflare Tunnel, Cloudflare terminates HTTPS, so traffic passes through its edge; with Tailscale Serve it stays on your tailnet.

License: not yet decided — all rights reserved for now.

Not affiliated with OpenAI. Codex is a trademark of OpenAI.
