# App-server fixtures

Hand-built JSONL event streams for `codex app-server` 0.165.0. Their shape follows a live capture of one tiny turn (see `docs/PROTOCOL_NOTES.md`), with every identifier, path, model name and MCP server name replaced. Nothing here comes from a real project.

Each line is one server message, in order. Placeholders are filled by the loader:

| Placeholder | Meaning |
|---|---|
| `{{threadId}}`, `{{turnId}}` | ids chosen by the mock server |
| `{{prompt}}` | the text the client sent in `turn/start` |
| `{{cwd}}` | the thread's working directory |
| `{{skillName}}`, `{{skillPath}}` | the skill input item, if any |
| `{{requestId}}`, `{{decision}}` | the server-initiated request id and the client's answer |

Lines whose object starts with `$` are directives for the mock server and are skipped by extraction tests:

- `{"$waitForInterrupt": true}` pauses until the client sends `turn/interrupt`.
- `{"$request": {method, params}}` sends a server-initiated request and waits for the client's response.
- `{"$ifDecision": [...], "then": [...], "else": [...]}` branches on the last approval decision.

| Fixture | Scenario |
|---|---|
| `normal` | commentary, a command run, then a markdown `final_answer` |
| `interrupted` | commentary stream that stops on `turn/interrupt` |
| `failed-usage-limit` | `error` with `usageLimitExceeded`, then a failed turn |
| `approval` | command approval round trip, answer depends on the decision |
| `skill` | turn started with a `skill` input item |
| `no-phase` | agent messages without `phase` (fallback to the last message) |
