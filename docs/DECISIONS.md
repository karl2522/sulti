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

## D9. Fixtures are hand-built from one live capture

- **Decision:** one live turn ("Reply with only the word PONG.") was captured to learn the exact event shapes; the six committed fixtures are hand-built in that shape with fictional content.
- **Reason:** keeps Codex usage to one turn, and real captures contain MCP server names, paths and account details that must not be published.
- **Alternative:** capturing all five scenarios live (about five turns and heavy redaction).
