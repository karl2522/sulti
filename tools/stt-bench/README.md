# Speech-to-text bench (T6)

Sulti's prototype relies on the iOS keyboard microphone for dictation. This bench checks whether a **local** speech-to-text engine on the PC would be fast and accurate enough to replace it. It times [whisper.cpp](https://github.com/ggml-org/whisper.cpp) on short recordings of real Sulti commands, then sends each transcript through Sulti's intent router (`packages/core`) and scores whether the command would have done the right thing.

Routing accuracy matters more than word accuracy. "use execute planes" is a perfect result if it still routes to the `execute-plans` skill.

Nothing here downloads models or binaries. You install them yourself.

## What you need

- **whisper.cpp for Windows.** On the target PC (i5 12th gen, RTX 3050, 16 GB RAM), use a CUDA build from the whisper.cpp releases page (`whisper-cublas-…-bin-x64.zip`). Unzip it anywhere; the bench needs `whisper-cli.exe`, or `whisper-server.exe` for server mode.
- **A model.** Start with `ggml-base.en.bin` and compare it with `ggml-small.en.bin`. Both fit easily in the 3050's memory. `medium.en` (or its `q5_0` quantization) is the accuracy ceiling worth trying.
- **Recordings.** One WAV per line of `utterances.tsv`, named as in its first column, saved in one folder. Say each phrase the way you'd dictate it to the phone. whisper.cpp wants 16 kHz mono 16-bit PCM. To convert from an iPhone voice memo:

  ```powershell
  ffmpeg -i 01.m4a -ar 16000 -ac 1 -c:a pcm_s16le 01-switch-soul-harbor.wav
  ```

Keep the recordings outside the repo, or in `test/live-output/`, which is gitignored. They're your voice.

## Run it

Build first, because the bench uses the compiled router:

```powershell
npm run build

# Router baseline on the typed phrases (no audio). Should be 100%.
node tools/stt-bench/bench.ts --text-only

# whisper-cli: one process per file, so latency includes loading the model.
node tools/stt-bench/bench.ts --whisper C:\tools\whisper\whisper-cli.exe --model C:\tools\whisper\ggml-base.en.bin --dir D:\recordings\sulti

# whisper-server keeps the model loaded, which is closer to how Sulti would use it.
C:\tools\whisper\whisper-server.exe -m C:\tools\whisper\ggml-small.en.bin --host 127.0.0.1 --port 8080
node tools/stt-bench/bench.ts --server http://127.0.0.1:8080 --dir D:\recordings\sulti
```

The bench also takes these options:

- `--threads N` sets CPU threads for whisper-cli.
- `--prompt "Sole Harbor, Lead Tracker, Kernel Labs, execute-plans"` biases recognition toward your session and skill names.
- `--cases other.tsv` uses a different phrase list.
- `--out file.json` writes the results somewhere else. The default is `test/live-output/stt-bench.json`.
- `--server` accepts loopback URLs only.

## Reading the results

Each line shows the latency, the file, the expected route, the actual route and the transcript. The summary gives routing accuracy, plus median and p90 latency.

- **Latency.** Server mode is the number that matters. As a rough bar, a command that takes much more than a second to transcribe feels slower than the iOS keyboard.
- **A miss with a reasonable transcript.** That's a router gap. Add the misheard form as a session alias in `sessions.json`, or improve the fuzzy matcher.
- **A miss with a garbled transcript.** Try a bigger model or `--prompt`.

## `utterances.tsv`

The file has tab-separated columns: the WAV file name, the expected route and the phrase. The phrases are the Section 9 corpus from `docs/BUILD_PROMPT.md`, using fictional sessions and skills. Expected routes look like this:

| Expected | Meaning |
|---|---|
| `prompt:lead-tracker` | a Codex prompt to Lead Tracker |
| `codex:skill:execute-plans` | invoke that skill |
| `codex:goal.set`, `codex:goal.update:paused`, `codex:interrupt` | goal and turn control |
| `app:playback:read`, `app:copy:ask`, `app:showApprovals` | handled on the phone |
| `app:switchSession:?!` | no session matched; must ask for confirmation |

A trailing `!` means the router must ask for confirmation. `npm test` checks that every phrase routes as expected from the typed text, so the file can't drift from the router.

