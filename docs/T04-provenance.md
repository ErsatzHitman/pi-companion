# T04 Provenance — Port server daemon with Pi provider

Source: `D:\paseo` (also reachable as `/d/paseo`) — Paseo `v0.3.0-beta.2`,
commit `ede26c8e2e210b9e12cca0e6d6cf3e10a07208f8`, AGPL-3.0-or-later.
The reference checkout is READ-ONLY and was never modified.
**Nothing from `D:\paseo\packages\app` was copied or referenced.**

This document records exactly what T04 copied and changed, for AGPL attribution
(to be consolidated in T05 / `THIRD_PARTY_NOTICES.md` per plan §10.1).

## 1. Package copied

### `packages/server` — `@picompanion/server` (v0.3.0-beta.2)

Copied verbatim with `git archive HEAD -- packages/server` from the reference
checkout (**696 tracked files**). The resulting tree hash is byte-identical to
the reference tree:

```
git rev-parse HEAD:packages/server        # in D:\paseo
309a6ebf0df91e2646c1bc5289a32702b3cc0588
git rev-parse <import-commit>:packages/server   # in this repo (commit 0cee983)
309a6ebf0df91e2646c1bc5289a32702b3cc0588
```

Subsystems included: agent manager + storage + timeline, provider registry and
snapshots, terminal PTY (`node-pty`, `@xterm/headless`, shell integration),
auth/pairing/relay runtime, hub, file explorer + file download, git/worktree and
workspace services, push notifications, speech (sherpa-onnx local + OpenAI),
MCP servers, service proxy, web middleware, and the daemon supervisor scripts.

The Pi provider is complete and present:

- `src/server/agent/providers/pi/agent.ts`, `cli-runtime.ts`, `runtime.ts`,
  `rpc-types.ts`, `rewind.ts`, `history-mapper.ts`, `tool-call-mapper.ts`,
  `session-descriptor.ts`
- `src/server/agent/providers/pi/ui-bridge/` — `schema.ts`, `decoder.ts`,
  `state.ts`, `actions.ts`
- `src/server/agent/providers/pi/pi-session-watcher.ts`
- `src/server/agent/providers/pi/pi-live-tail.ts`
- `src/server/agent/providers/pi/test-utils/fake-pi.ts`

Note: the reference's _tracked source_ already contains only the Pi provider —
`providers/claude/`, `providers/codex*`, `providers/opencode*`, `providers/omp/`
and the ACP agents exist in the reference working tree solely as stale
**untracked `.js` build artifacts**, which `git archive` (correctly) did not
copy. No non-Pi provider source ever entered this repository.

Also note: the reference `packages/protocol/src/provider-manifest.ts` (imported
by T02) already declares `AGENT_PROVIDER_DEFINITIONS = [{ id: "pi", ... }]`, so
Pi-only is the reference's own upstream state, not a divergence introduced here.

## 2. Files deleted from the verbatim copy (dead non-Pi surface)

Every file below was **provably dead on arrival**: it imports a module that does
not exist in the reference's tracked source (the removed Claude/Codex/OpenCode/
Omp/mock provider clients), so it cannot even be loaded by Vitest or `tsx`. They
were removed rather than kept as broken imports.

Removed in commit `c28b14d` (rescued WIP):

- `src/server/agent/provider-registry.test.ts` (imports `providers/omp/test-utils/fake-omp.js`)
- `src/server/agent/providers/provider-availability.test.ts` (imports `claude/agent.js`, `codex-app-server-agent.js`, `opencode-agent.js`)
- `src/server/agent/providers/provider-availability.posix.test.ts` (same)
- `src/server/daemon-e2e/opencode-omo-real-runtime.ts` (imports `opencode-agent.js`, `opencode/server-manager.js`)
- `src/server/daemon-e2e/opencode-omo-real-runtime.test.ts`
- `src/server/daemon-e2e/opencode-omo-autonomous.real.e2e.test.ts`

Removed while completing T04:

- `src/server/agent/agent-response-loop.real.e2e.test.ts`
- `src/server/daemon-e2e/agent-refresh-rehydrates-timeline.e2e.test.ts`
- `src/server/daemon-e2e/claude-autonomous-wake.real.e2e.test.ts`
- `src/server/daemon-e2e/claude-autonomous-wake-simple.real.e2e.test.ts`
- `src/server/daemon-e2e/claude-live-usage.e2e.test.ts`
- `src/server/daemon-e2e/claude-rewind.real.e2e.test.ts`
- `src/server/daemon-e2e/claude-thinking-memory.real.e2e.test.ts`
- `src/server/daemon-e2e/codex-auto-review.local.e2e.test.ts`
- `src/server/daemon-e2e/codex-goal-mid-turn.real.e2e.test.ts`
- `src/server/daemon-e2e/codex-rewind.real.e2e.test.ts`
- `src/server/daemon-e2e/live-relay.real.e2e.test.ts`
- `src/server/daemon-e2e/model-resolution-on-init.real.e2e.test.ts`
- `src/server/daemon-e2e/model-runtime-reconcile-claude.real.e2e.test.ts`
- `src/server/daemon-e2e/omp.real.e2e.test.ts`
- `src/server/daemon-e2e/opencode-custom-agents.real.e2e.test.ts`
- `src/server/daemon-e2e/opencode-draft-features.real.e2e.test.ts`
- `src/server/daemon-e2e/opencode-import-persistence.real.e2e.test.ts`
- `src/server/daemon-e2e/opencode-initial-prompt-wait.real.e2e.test.ts`
- `src/server/daemon-e2e/opencode-invalid-mode.real.e2e.test.ts`
- `src/server/daemon-e2e/opencode-invalid-model.real.e2e.test.ts`
- `src/server/daemon-e2e/opencode-plan-and-questions.real.e2e.test.ts`
- `src/server/daemon-e2e/opencode-rewind.real.e2e.test.ts`
- `src/server/daemon-e2e/opencode-send-interrupt.real.e2e.test.ts`
- `src/server/daemon-e2e/rewind-user-message-dedupe-claude.real.e2e.test.ts`
- `src/server/daemon-e2e/send-during-tool-call-claude.real.e2e.test.ts`
- `src/server/daemon-e2e/send-during-tool-call-codex.real.e2e.test.ts`
- `src/server/daemon-e2e/send-while-running-stuck.real.e2e.test.ts`
- `src/server/daemon-e2e/send-while-running-stuck-claude.real.e2e.test.ts`
- `src/server/daemon-e2e/ui-action-stress.real.e2e.test.ts`
- `src/server/workspace-same-cwd-isolation.e2e.test.ts` (imports `mock-load-test-agent.js`)
- `scripts/test-mcp-inject.ts` (imports `claude-agent.js`, `codex-app-server-agent.js`)
- `scripts/test-codex-mcp-servers.ts`

After these deletions the only remaining dangling relative import in
`packages/server` is `src/server/hub/test-utils/hub-cli-entry.ts` →
`packages/cli/src/commands/hub/index.js`, which is satisfied by T03
(`packages/cli`) once the phase-0 branches are merged.

**Not removed:** e2e suites that drive the _fake_ agent clients in
`src/server/test-utils/fake-agent-client.ts` (which the reference registers under
the `claude` / `codex` / `opencode` ids), e.g. `permissions-claude.e2e.test.ts`.
These contain no non-Pi provider code — they are provider-agnostic daemon tests
with fake clients — so they were kept, per "no other providers' dead code beyond
what the source tree already carries".

## 3. Local modifications to copied files

1. `src/server/agent/agent-manager.test.ts`, `create-agent/create.test.ts`,
   `provider-launch-config.test.ts`, `provider-snapshot-manager.test.ts`,
   `bootstrap-provider-availability.test.ts`, `daemon-config-store.test.ts`,
   `persisted-config.test.ts`, `project-key.test.ts`, `session.workspaces.test.ts`,
   `paseo-worktree-service.test.ts`, `worktree-session.test.ts`, and ~20 further
   test files (commit `c28b14d`): fixtures that named non-Pi providers were
   re-pointed at `pi`, and `AgentManager` fakes now supply their default mode via
   the `AgentClient.resolveDefaultModeId` hook instead of relying on manifest
   entries that the Pi-only manifest no longer carries. Assertions are unchanged.
2. `src/server/daemon-e2e/real-provider-test-config.ts`: reduced to the Pi case
   (`realProviders = ["pi"]`); the Claude/Codex/OpenCode/Omp branches and their
   dead client imports were removed. Pi model/auth resolution is unchanged.
3. `src/server/daemon-e2e/user-message-contract.real.e2e.test.ts`: contract table
   reduced to the Pi case for the same reason.
4. `src/services/gitlab-facts.ts`, `src/utils/project-icon.ts` (commit `c28b14d`):
   comments referencing `packages/app` were reworded — no code change.
5. `src/test-utils/vitest-setup.ts` (**new behaviour**): pins
   `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` to an empty scratch
   directory when the caller has not set them. Without this the Pi session
   watcher and live tail resolve `~/.pi/agent/sessions` and watch — and
   auto-import — the developer's real Pi sessions during the test run, which made
   `bootstrap.smoke`, `bootstrap-auth`, `bootstrap-web-ui` and
   `snapshot-mutation-ownership` time out on any machine with a real Pi install
   (11 + 4 + 2 + 4 failures before the fix, 0 after).
6. `package.json`: added `"smoke:daemon": "tsx scripts/smoke-daemon-hello.ts"`.
   Package name/deps otherwise untouched (dependency pruning is T11).

## 4. New file (not from the reference)

- `packages/server/scripts/smoke-daemon-hello.ts` — original code written for
  this repository. One-shot acceptance check: spawns the built daemon worker
  against a scratch `PASEO_HOME` (plus a scratch Pi agent dir, voice/dictation
  disabled so no speech models are downloaded), waits for `/api/health`, performs
  the WebSocket `hello` handshake on `/ws`, asserts the daemon answers with the
  `server_info` status payload, then SIGTERMs the daemon and removes the scratch
  tree. Always exits (never watches).

## 5. Verification (all one-shot, on Windows / Node v22.23.1)

- `npm run build --workspace=@picompanion/protocol|highlight|relay|client` → OK
  (the server's `tsc` build resolves those packages through their `dist`
  entrypoints, so they must be built first).
- `npm run build --workspace=@picompanion/server` → OK (`build:lib` + `build:scripts`).
- `npm run smoke:daemon --workspace=@picompanion/server` →
  `daemon smoke OK  home=…\.paseo listen=127.0.0.1:<port> serverId=srv_… version=0.3.0-beta.2`
- Pi provider suite (`vitest run src/server/agent/providers/pi`) →
  **5 files, 88 tests passed** (agent, cli-runtime, history-mapper,
  session-descriptor, tool-call-mapper; `ui-bridge/*` is exercised through
  `agent.test.ts`).
- Full unit suite (`vitest run --fileParallelism --exclude "**/*.e2e.test.ts"`)
  → **246 files: 230 passed, 9 skipped, 7 failed — 3289 tests passed, 66 failed**,
  every failure accounted for in §6. (Before the `vitest-setup.ts` Pi-dir pin the
  same command reported 10 failed files / 76 failed tests.)

## 6. Known-failing tests on this branch (not caused by the port)

| Test file(s)                                                                                                                                                 | Cause                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/hub/hub-cli-contract.test.ts`, `hub/daemon-executions.test.ts`, `hub/execution-session.websocket.test.ts`, `hub/relationship-controller.test.ts` | `hub-cli-entry.ts` spawns `packages/cli`, delivered by **T03**; unresolvable in this isolated worktree. Expected to pass after the phase-0 merge. |
| `src/terminal/worker-terminal-manager.test.ts` (1 test)                                                                                                      | `resolvePaseoCliBinDir()` resolves `@picompanion/cli/bin/paseo` — same **T03** dependency.                                                        |
| `src/server/file-explorer/observer.test.ts` (1 test)                                                                                                         | `EPERM: operation not permitted, symlink` — Windows without Developer Mode/admin. Environmental.                                                  |

Everything else in the unit suite passes. Under `--fileParallelism` on a loaded
machine a small number of process-spawning suites (`src/utils/spawn.launch-regression.test.ts`,
`src/services/github-service.test.ts`, the `worker-terminal-manager` PTY cases)
can hit the 30 s test timeout; each passes when its file is run on its own.

Targeted one-shot commands used to verify:

```
npx vitest run src/server/agent/providers/pi              # 5 files / 88 tests
npx vitest run src/server/bootstrap.smoke.test.ts \
               src/server/bootstrap-auth.test.ts \
               src/server/bootstrap-web-ui.test.ts \
               src/server/bootstrap-provider-availability.test.ts \
               src/server/snapshot-mutation-ownership.test.ts
npm run smoke:daemon --workspace @picompanion/server
```

## 7. Hand-off notes for T05 / T11

- **T05**: attribute `packages/server` (658 reference-derived files after
  trimming, from 696 copied, less the 38 files itemized in §2 — **corrected
  T43B1, 2026-09-06**: this line previously said "657"/"39 removed", which
  matched neither §2's own itemized lists (6 + 32 = 38) nor 696 − 38 = 658;
  plus 1 file original to this repo, `scripts/smoke-daemon-hello.ts` — the
  `vitest-setup.ts` Pi-dir pin is a behavioral change to an already-ported
  file, per §3 item 5, not a second new file) to Paseo `v0.3.0-beta.2` (`ede26c8e2`), AGPL-3.0-or-later,
  copyright Mohamed Boudra / Paseo project. `scripts/smoke-daemon-hello.ts` is
  original to this repository. `packages/server/CLAUDE.md`, `AGENTS.md` and
  `README.md` are reference documents carried over verbatim.
- **T11**: `packages/server/package.json` still carries the reference's full
  dependency list. Measured references in `src/` + `scripts/` after this task:
  - `@anthropic-ai/sdk`, `@opencode-ai/sdk`, `@agentclientprotocol/sdk`,
    `@playwright/test` — **0 references**, safe prune candidates.
  - `@anthropic-ai/claude-agent-sdk` — 1 reference, a _type-only_ import in
    `src/server/agent/agent-sdk-types.ts` (`Options as ClaudeAgentOptions`);
    prune together with that type alias.

  Verify with `knip` before removing.

## License

All copied source remains AGPL-3.0-or-later, copyright Mohamed Boudra / Paseo
project. Attribution to be consolidated in `THIRD_PARTY_NOTICES.md` by T05.
