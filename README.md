# Sulti

Sulti (Cebuano for "speak") is a voice-first iPhone remote for Codex sessions running on a Windows PC. It reads complete Codex answers aloud, and it routes what you dictate to the right project session: switch projects, send prompts, run skills, manage goals, stop turns and approve actions, without going back to the keyboard.

**Status:** working prototype. The PC side is tested against a mock Codex app-server and with live Codex turns. The iPhone checks are an owner checklist in [docs/MANUAL_TESTS.md](docs/MANUAL_TESTS.md).

## How it works

A small **companion** runs on your PC. It drives `codex app-server` for the projects you list, and it also receives the finished answers from your existing Codex terminals through a Stop hook. It serves the **phone app**, which you open on your iPhone through Tailscale Serve (HTTPS on your tailnet, nothing public).

- **Listen.** Every finished answer appears on the phone and can be read aloud. The phone can speak it with its own voice, or play audio rendered on the PC, which keeps working on the lock screen and with AirPods controls. Code blocks are summarized, and paths and links are shortened for speech.
- **Talk.** Dictate with the iOS keyboard microphone. "tell lead tracker to investigate the checkout problem", "use systematic debugging", "set the goal to …", "stop codex", "read it again". Sulti shows how it understood you, asks when it isn't sure, and never runs shell commands itself. "Run the tests" becomes a Codex prompt.
- **Approvals** show up as cards. Only a tap approves; saying "approve" just shows the cards.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the diagram and the security model.

## Quick start

You need Windows 10 or 11, Node.js 22+, the Codex CLI (`codex --version`, tested with 0.165.0), and Tailscale on the PC and the iPhone.

```powershell
npm ci
New-Item -ItemType Directory -Force "$env:APPDATA\sulti" | Out-Null
Copy-Item apps\companion\sessions.example.json "$env:APPDATA\sulti\sessions.json"   # then list your projects
npm run build        # builds the companion and the phone app
tailscale serve --bg 7417   # check the syntax with: tailscale serve --help
npm start            # prints a pairing link and QR code
```

Open the pairing link on the iPhone, tap **Pair**, then **Add to Home Screen**. To hear your existing terminals too, review and run `scripts\hooks\install-hook.ps1`, restart your terminals and trust the hook with `/hooks`. [docs/MANUAL_TESTS.md](docs/MANUAL_TESTS.md) has the full, ordered setup.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Start the companion (phone server on `127.0.0.1:7417`, local control on `127.0.0.1:7418`) |
| `npm run pair` | Print a new one-time pairing link from the running companion |
| `npm run devices -- list` / `revoke <id>` | Manage paired phones |
| `npm run build` / `typecheck` / `test` | Build, typecheck, and run the tests (mocks only, no Codex usage) |
| `npm run scan` | Secret scan over every tracked file |
| `npm run smoke:live` | Two tiny real Codex turns (costs your plan) |
| `npm run dev:phone` | Phone app dev server on `127.0.0.1:5173`, proxying to a running companion |

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Decisions](docs/DECISIONS.md)
- [Protocol notes](docs/PROTOCOL_NOTES.md), meaning what the installed Codex actually does
- [Manual tests](docs/MANUAL_TESTS.md), the owner checklist
- [Report](docs/REPORT.md), covering status, evidence and next steps
- [Build prompt](docs/BUILD_PROMPT.md), the original specification

## Privacy and safety

Everything stays on your PC and tailnet. There is no telemetry, every listener binds to `127.0.0.1`, and Sulti never reads your Codex credentials. Your sessions, paired devices, answers and audio live in `%APPDATA%\sulti`, which is never committed. The phone talks only to your companion, and your companion talks only to Codex.

License: not yet decided — all rights reserved for now.

Not affiliated with OpenAI. Codex is a trademark of OpenAI.
