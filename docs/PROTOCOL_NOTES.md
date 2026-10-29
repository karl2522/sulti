# Protocol notes

Verified against the installed Codex on the build machine. Where the build prompt and the installed version disagree, Sulti follows the installed version and the difference is listed here.

## Versions

| Component | Version |
|---|---|
| Codex CLI | `codex-cli 0.165.0` (also in `packages/protocol/CODEX_VERSION`) |
| Node.js | `v24.19.0` (repo requires `>=22`) |
| Windows | Windows 11, NT `10.0.26300`, x64 |

Sources: `codex --help`, `codex app-server --help`, `codex features list`, the types from `codex app-server generate-ts`, the official docs pages for App Server, Hooks and Remote connections, and one live capture turn (`packages/protocol/scripts/capture.mjs`, read-only sandbox, temp directory, ephemeral thread).

## Types

`npm run gen:protocol` runs `codex app-server generate-ts --out packages/protocol/src/generated` (751 files for 0.165.0) and writes the version to `packages/protocol/CODEX_VERSION`.

- **Difference:** the generated files import siblings without file extensions (`from "./Thread"`) and re-export a folder (`export * as v2 from "./v2"`). That fails under NodeNext resolution, so the generator script rewrites relative imports to `./Thread.js` and `./v2/index.js`.
- `generate-ts` also has `--experimental`, which adds experimental methods. Sulti doesn't need it: every method it uses is on the stable surface.

## App-server facts

| Fact from the build prompt | Status in 0.165.0 |
|---|---|
| JSONL over stdio, `"jsonrpc"` omitted | Confirmed. Every server message also carries an undocumented `emittedAtMs` field; Sulti ignores it. |
| `initialize` (with `clientInfo`) then `initialized` | Confirmed. `ClientInfo` is `{name, title, version}`; `capabilities` may be `null`. The result is `{userAgent, codexHome, platformFamily, platformOs}`. `codexHome` is a local path and is never logged or sent to the phone. |
| Threads: `thread/start`, `thread/resume`, `thread/list` (by `cwd`), `thread/read` | Confirmed. `thread/list` takes `cwd: string or string[]` with exact match. Threads started by Sulti report `source: "vscode"` and `originator: "sulti"`. |
| `thread/start` sandbox enum | Confirmed: `read-only`, `workspace-write`, `danger-full-access`. |
| `thread/start` approval-policy enum | `untrusted`, `on-request`, `never`, or a `{granular: …}` object. There is no `on-failure`. Sulti defaults to `on-request`. |
| Turns: `turn/start`, `turn/interrupt` | Confirmed. `turn/interrupt` needs both `threadId` and `turnId` and returns `{}`; the turn then completes with `interrupted`. A text input item must include `text_elements: []`. |
| Skills: `skills/list` per `cwd` | Confirmed. Params are `{cwds?: string[], forceReload?}`. The result is `{data: [{cwd, skills: [{name, description, path, scope, enabled, pluginId, …}], errors}]}`. |
| Skill invocation: `$name` in text plus `{type:"skill", name, path}` | Confirmed (`UserInput` union, and the docs example). |
| Goals: `thread/goal/set`, `get`, `clear`; same state as `/goal`; objective non-empty and at most 4,000 chars | Confirmed, on the stable API. Status values: `active`, `paused`, `blocked`, `usageLimited`, `budgetLimited`, `complete`. Pause and resume are `thread/goal/set {threadId, status}` without an objective (usage history is kept). `set` and `clear` accept `origin: "user"` or `"automatic"`; the type notes that "missing provenance does not supply user authorization", so Sulti sends `origin: "user"` for phone actions. `clear` returns `{cleared: boolean}`. Updates arrive as `thread/goal/updated` and `thread/goal/cleared`. |
| Goals on any thread | **Difference:** ephemeral threads reject goal calls (`-32600 ephemeral thread does not support goals`). Sulti's sessions use persisted threads; the live smoke test and T5 do too. |
| Models: `model/list`; don't hardcode a model | Confirmed. Sulti never sends `model`; the live turn used the owner's configured default. |
| Notifications: `turn/started`, `turn/completed`, `item/started`, `item/completed`, `item/agentMessage/delta`, `thread/status/changed`, `error` | Confirmed. `TurnStatus` is `completed`, `interrupted`, `failed`, plus `inProgress` (only in `turn/started`). `turn/completed` carries `turn.items` with `itemsView: "summary"`, which included the final agent message in the live capture. `error` is `{error: {message, codexErrorInfo, additionalDetails}, willRetry, threadId, turnId}`. |
| Final answer = `agentMessage` with `phase: "final_answer"`; fall back to the last `agentMessage` | Confirmed. In the live capture `item/started` had `phase: null` and `item/completed` had `phase: "final_answer"`, so Sulti reads the phase from `item/completed` only. |
| Approvals: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`; decisions `accept`, `acceptForSession`, `decline`, `cancel` | Confirmed. Command approvals also allow amendment variants, which Sulti never sends. After the answer the server emits `serverRequest/resolved {threadId, requestId}`; Sulti uses it to clear approval cards. Other server requests (`item/tool/requestUserInput`, `item/permissions/requestApproval`, MCP elicitation, legacy `execCommandApproval` and `applyPatchApproval`) get an error or a decline. They are never auto-approved. |
| Unsandboxed: `thread/shellCommand`, `command/exec`, `process/*` | Confirmed for `thread/shellCommand` and `command/exec` (plus `command/exec/write`, `terminate`, `resize`). In 0.165.0 `process/*` only appears as notifications. Sulti's client sends only an explicit allowlist of 13 methods and refuses the rest before they reach the wire (`packages/protocol/src/methods.ts`). |
| Windows sandbox may need setup (`windowsSandbox/setupStart`) | `windowsSandbox/readiness` returned `{status: "ready"}` on the build machine, so no setup is needed here. Sulti calls `readiness` at startup and tells the owner if it isn't ready; it never starts setup itself. |
| Errors | `codexErrorInfo` values include `usageLimitExceeded`, `rateLimitExceeded`, `contextWindowExceeded`, `serverOverloaded`, `unauthorized`, and objects such as `{httpConnectionFailed: {httpStatusCode}}`. |
| Overload | In WebSocket mode the server may answer `-32001 "Server overloaded; retry later."`; clients retry with backoff. |
| Experimental API | Methods behind `capabilities.experimentalApi` are rejected unless opted in. Sulti doesn't opt in. |
| Hook notifications | `hook/started` and `hook/completed` are emitted for synchronous hooks only. |
| Live-capture noise | A real app-server emits `mcpServer/startupStatus/updated` for every configured MCP server, including server names and login hints. Sulti ignores these and never stores them. |

## Shared mode (WebSocket)

- `codex app-server --listen ws://127.0.0.1:4500`: confirmed. `--listen` also accepts `stdio://` (default), `unix://`, `unix://PATH` and `off`.
- Auth flags: confirmed: `--ws-auth capability-token --ws-token-file <absolute path>`. Also available: `--ws-token-sha256 <hex>`, and `--ws-auth signed-bearer-token --ws-shared-secret-file …` with `--ws-issuer`, `--ws-audience`, `--ws-max-clock-skew-seconds`.
- Clients send `Authorization: Bearer <token>` in the handshake, and the server enforces it before `initialize`.
- The TUI attaches with `codex --remote ws://127.0.0.1:4500 --remote-auth-token-env <ENV_VAR>` (confirmed in `codex --help`).
- The server also exposes HTTP probes `GET /readyz` and `GET /healthz`; requests carrying an `Origin` header are rejected with 403.
- The docs still call the WebSocket transport experimental and unsupported, and non-loopback listeners still accept unauthenticated connections by default.

## Stop hook

| Question | Answer for 0.165.0 |
|---|---|
| Feature flag | `hooks`, **stable and on by default** (`codex features list`). `codex_hooks` is a deprecated alias. |
| Config location | Either `~/.codex/hooks.json` or inline `[hooks]` tables in `~/.codex/config.toml` (also per repo under `.codex/`). All matching sources run. Sulti's installer appends inline TOML to the user's `config.toml`. |
| TOML shape | `[[hooks.Stop]]` then `[[hooks.Stop.hooks]]` with `type = "command"`, `command = '…'`, optional `timeout` (seconds), `async`, `statusMessage`, `command_windows`. Stop ignores `matcher`. |
| Trust | **Difference:** non-managed hooks must be reviewed and trusted in the TUI with `/hooks` before they run. Trust is tied to the hook's hash, so editing the hook requires trusting it again. This is an owner step in `docs/MANUAL_TESTS.md`. |
| Delivery | **stdin**, one JSON object. Common fields: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`. Stop adds `turn_id`, `stop_hook_active`, `last_assistant_message` (string or null). |
| Output and exit codes | Exit 0 with **no output** means "continue". For Stop, plain-text stdout is invalid. JSON `{"decision":"block","reason":…}` or exit code 2 makes Codex **continue the turn** with a new prompt, so Sulti's hook prints nothing and always exits 0. |
| Blocking | Hooks are synchronous by default. `async = true` runs a command hook in the background, and it can't control the turn. Sulti's installer sets `async = true` and `timeout = 5`, and the hook itself gives up on the HTTP post after 1,500 ms. |
| Working directory | Hook commands run with the session `cwd`. |
| `session_id` vs thread id | The docs example uses the thread id (`thr_…`). Sulti dedupes by `turn_id`, which matches the app-server turn id. The owner can confirm the field names with `stop-hook.mjs --debug`. |
| Legacy `notify` | Not used. The Stop hook gives the same final message plus `turn_id` and `cwd`. |

## Stop hook, verified live on Windows

Checked with Codex 0.165.0 on the build machine, using the hook in `--debug` mode against a temporary data folder:

- **Payload.** The hook received one JSON object on **stdin** (about 350 bytes for a short answer). Its keys were `cwd`, `hook_event_name` (`"Stop"`), `last_assistant_message`, `model`, `permission_mode`, `session_id`, `stop_hook_active`, `transcript_path` and `turn_id`. Nothing arrived on argv.
- **Command quoting on Windows.** Hook commands run through PowerShell. A command that *starts* with a quoted executable path (`"C:\…\node.exe" "…\stop-hook.mjs"`) fails, because PowerShell parses it as a string expression. An **unquoted** node path followed by a quoted script path works. The installer therefore resolves symlinked node installs (fnm, nvm) to the real `node.exe`, and uses its 8.3 short path when it contains spaces.
- **`command_windows` and `async = true`.** Both work. The async hook ran after the turn without delaying it.
- **Trust.** The hook did nothing until it was trusted with `/hooks` (see "Trust" above).

## Shared mode, verified live (T5)

From `tools/shared-session/two-clients.ts`, run against a server it spawned on loopback with a temporary capability token:

- **Auth.** A WebSocket client without the token is refused during the handshake with HTTP **401**. With the token, `initialize` succeeds.
- **Resume timing.** **Difference:** `thread/resume` on a persisted thread that has had no turn yet fails with `no rollout found for thread id …`, even while the thread is loaded on the same server. A second client can attach only once the first turn has started.
- **Live events after resume.** A second client that resumes **while a turn is running** receives the rest of that turn live: `item/started`, `item/agentMessage/delta`, the agent message's `item/completed`, `thread/tokenUsage/updated` and `turn/completed`. Notifications for a thread go to every client subscribed to it, not only to the client that started the turn.
- **Extra notifications.** After `thread/resume` the resuming client also got a `deprecationNotice`, most likely about full-history hydration on resume (`excludeTurns` plus `thread/turns/list` is the suggested replacement). Sulti ignores it. Both clients also see account, MCP and `remoteControl/status/changed` notifications, which Sulti ignores.
- **Process tree.** Through an npm install, `codex app-server` runs as `node codex.js` with a native `codex.exe` child. Killing only the node process leaves the listener alive, so the test stops the server with `taskkill /T`.

## Installed copies of Codex

The build machine had three copies of `codex`: the npm CLI (0.165.0), a copy bundled with the desktop app in its own `bin` folder (0.140.0), and the desktop app's internal app-server builds. The 0.140 copy can't parse the current `config.toml`; it fails with `invalid type: map, expected a boolean` on a newer `[features]` entry. Sulti resolves `codex` in PATH order like `cmd.exe` (D10), so it runs the same CLI the owner gets in a terminal.
