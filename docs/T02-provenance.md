# T02 Provenance — Port protocol, relay, highlight

Source: `D:\paseo` (also reachable as `/d/paseo`) — Paseo `v0.3.0-beta.2`, AGPL-3.0-or-later.
Reference checkout is READ-ONLY. No files from `packages/app` were copied.

This document records exactly what T02 copied for AGPL attribution (to be consolidated in T05 / THIRD_PARTY_NOTICES.md per plan §10.1).

## Packages copied

### 1. `packages/protocol` — `@picompanion/protocol`

Copied via `git archive HEAD -- packages/protocol` (107 tracked files). Full file list from `git ls-files -- packages/protocol`:

- `packages/protocol/README.md`
- `packages/protocol/package.json`
- `packages/protocol/tsconfig.json`
- `packages/protocol/codegen/README.md`
- `packages/protocol/codegen/ws-outbound.compile.ts`
- `packages/protocol/scripts/generate-validation-aot.mjs`
- `packages/protocol/scripts/watch-validation-aot.mjs`
- `packages/protocol/src/agent-attention-notification.test.ts`
- `packages/protocol/src/agent-attention-notification.ts`
- `packages/protocol/src/agent-deep-link.test.ts`
- `packages/protocol/src/agent-deep-link.ts`
- `packages/protocol/src/agent-feature-schemas.test.ts`
- `packages/protocol/src/agent-labels.test.ts`
- `packages/protocol/src/agent-labels.ts`
- `packages/protocol/src/agent-lifecycle.ts`
- `packages/protocol/src/agent-state-bucket.test.ts`
- `packages/protocol/src/agent-state-bucket.ts`
- `packages/protocol/src/agent-title-limits.ts`
- `packages/protocol/src/agent-types.ts`
- `packages/protocol/src/binary-frames/demux.test.ts`
- `packages/protocol/src/binary-frames/demux.ts`
- `packages/protocol/src/binary-frames/file-transfer.test.ts`
- `packages/protocol/src/binary-frames/file-transfer.ts`
- `packages/protocol/src/binary-frames/index.ts`
- `packages/protocol/src/binary-frames/terminal.test.ts`
- `packages/protocol/src/binary-frames/terminal.ts`
- `packages/protocol/src/branch-slug.test.ts`
- `packages/protocol/src/branch-slug.ts`
- `packages/protocol/src/browser-automation/capabilities.ts`
- `packages/protocol/src/browser-automation/rpc-schemas.test.ts`
- `packages/protocol/src/browser-automation/rpc-schemas.ts`
- `packages/protocol/src/chat/rpc-schemas.ts`
- `packages/protocol/src/chat/types.ts`
- `packages/protocol/src/client-capabilities.ts`
- `packages/protocol/src/connection-offer.test.ts`
- `packages/protocol/src/connection-offer.ts`
- `packages/protocol/src/daemon-endpoints.test.ts`
- `packages/protocol/src/daemon-endpoints.ts`
- `packages/protocol/src/error-utils.ts`
- `packages/protocol/src/forge-manifest.ts`
- `packages/protocol/src/generated/validation/README.md`
- `packages/protocol/src/git-remote.test.ts`
- `packages/protocol/src/git-remote.ts`
- `packages/protocol/src/host-connection-schema.ts`
- `packages/protocol/src/literal-union.ts`
- `packages/protocol/src/loop/rpc-schemas.ts`
- `packages/protocol/src/messages.attachments.test.ts`
- `packages/protocol/src/messages.browser-automation.test.ts`
- `packages/protocol/src/messages.checkout-commit-file-diff.test.ts`
- `packages/protocol/src/messages.checkout-commits.test.ts`
- `packages/protocol/src/messages.checkout-pr-schema.test.ts`
- `packages/protocol/src/messages.create-agent-client-message-id.test.ts`
- `packages/protocol/src/messages.create-agent-worktree-autoarchive.test.ts`
- `packages/protocol/src/messages.create-terminal-size.test.ts`
- `packages/protocol/src/messages.file-editing.test.ts`
- `packages/protocol/src/messages.hub.test.ts`
- `packages/protocol/src/messages.list-commands.test.ts`
- `packages/protocol/src/messages.project-command-center.test.ts`
- `packages/protocol/src/messages.provider-subagents.test.ts`
- `packages/protocol/src/messages.providers-snapshot.test.ts`
- `packages/protocol/src/messages.pull-request-timeline.test.ts`
- `packages/protocol/src/messages.rename-entities.test.ts`
- `packages/protocol/src/messages.stream-parsing.test.ts`
- `packages/protocol/src/messages.terminal-resize.test.ts`
- `packages/protocol/src/messages.terminal-restore.test.ts`
- `packages/protocol/src/messages.test.ts`
- `packages/protocol/src/messages.tool-call-schema.test.ts`
- `packages/protocol/src/messages.ts`
- `packages/protocol/src/messages.wire-compat.test.ts`
- `packages/protocol/src/messages.workspace-recovery.test.ts`
- `packages/protocol/src/messages.workspaces.test.ts`
- `packages/protocol/src/paseo-config-schema.test.ts`
- `packages/protocol/src/paseo-config-schema.ts`
- `packages/protocol/src/path-utils.ts`
- `packages/protocol/src/pi-ui-bridge/schema.ts`
- `packages/protocol/src/provider-config.ts`
- `packages/protocol/src/provider-icon-names.ts`
- `packages/protocol/src/provider-manifest.ts`
- `packages/protocol/src/provider-snapshot-codec.test.ts`
- `packages/protocol/src/provider-snapshot-codec.ts`
- `packages/protocol/src/schedule/cadence.test.ts`
- `packages/protocol/src/schedule/cadence.ts`
- `packages/protocol/src/schedule/cron-expression.test.ts`
- `packages/protocol/src/schedule/cron-expression.ts`
- `packages/protocol/src/schedule/rpc-schemas.test.ts`
- `packages/protocol/src/schedule/rpc-schemas.ts`
- `packages/protocol/src/schedule/types.test.ts`
- `packages/protocol/src/schedule/types.ts`
- `packages/protocol/src/terminal-activity.test.ts`
- `packages/protocol/src/terminal-activity.ts`
- `packages/protocol/src/terminal-input-mode.test.ts`
- `packages/protocol/src/terminal-input-mode.ts`
- `packages/protocol/src/terminal-key-input.test.ts`
- `packages/protocol/src/terminal-key-input.ts`
- `packages/protocol/src/terminal-profiles.test.ts`
- `packages/protocol/src/terminal-profiles.ts`
- `packages/protocol/src/terminal-snapshot.test.ts`
- `packages/protocol/src/terminal-snapshot.ts`
- `packages/protocol/src/terminal-stream-protocol.test.ts`
- `packages/protocol/src/terminal-stream-protocol.ts`
- `packages/protocol/src/terminal-subscription-key.ts`
- `packages/protocol/src/tool-call-display.test.ts`
- `packages/protocol/src/tool-call-display.ts`
- `packages/protocol/src/tool-name-normalization.ts`
- `packages/protocol/src/validation/ws-outbound-schema-metadata.ts`
- `packages/protocol/src/validation/ws-outbound.ts`
- `packages/protocol/tests/validation/ws-outbound.test.ts`

Generated at build time (not committed, gitignored):

- `packages/protocol/src/generated/validation/ws-outbound.aot.ts` (produced by `npm run generate:validators` via `zod-aot`)

### 2. `packages/relay` — `@picompanion/relay`

Copied via `git archive HEAD -- packages/relay` (15 tracked files):

- `packages/relay/package.json`
- `packages/relay/tsconfig.json`
- `packages/relay/wrangler.toml`
- `packages/relay/src/base64.ts`
- `packages/relay/src/cloudflare-adapter.test.ts`
- `packages/relay/src/cloudflare-adapter.ts`
- `packages/relay/src/crypto.test.ts`
- `packages/relay/src/crypto.ts`
- `packages/relay/src/cutover-proxy.test.ts`
- `packages/relay/src/cutover-proxy.ts`
- `packages/relay/src/dist-handshake-parity.test.ts`
- `packages/relay/src/e2e.test.ts` (patched locally to tolerate missing `wrangler` — see notes)
- `packages/relay/src/e2ee.ts`
- `packages/relay/src/encrypted-channel.test.ts`
- `packages/relay/src/encrypted-channel.ts`
- `packages/relay/src/index.ts`
- `packages/relay/src/live-relay.e2e.test.ts`
- `packages/relay/src/types.ts`

### 3. `packages/highlight` — `@picompanion/highlight`

Copied via `git archive HEAD -- packages/highlight` (11 tracked files):

- `packages/highlight/package.json`
- `packages/highlight/tsconfig.json`
- `packages/highlight/src/__tests__/colors.test.ts`
- `packages/highlight/src/__tests__/highlighter.test.ts`
- `packages/highlight/src/__tests__/parsers.test.ts`
- `packages/highlight/src/__tests__/themes.test.ts`
- `packages/highlight/src/colors.ts`
- `packages/highlight/src/highlighter.ts`
- `packages/highlight/src/index.ts`
- `packages/highlight/src/parsers.ts`
- `packages/highlight/src/syntax-roles.ts`
- `packages/highlight/src/themes.ts`
- `packages/highlight/src/types.ts`

### 4. Shared script

- `scripts/clean-package-dist.mjs` — copied from `D:\paseo\scripts\clean-package-dist.mjs` (required by `package.json#scripts.clean` in all three packages). AGPL-3.0-or-later.

## Exclusions

- `D:\paseo\packages\app` — never copied, never referenced (hard rule). Only synthetic path strings occur inside protocol test fixtures (e.g., `/paseo/worktrees/.../packages/app`) as test data, not as filesystem references.
- No other files from `D:\paseo` were copied.

## Local modifications

- `packages/relay/src/e2e.test.ts`: wrapped `wrangler/bin/wrangler.js` resolution in try/catch and made `shouldRunRelayE2e` depend on wrangler availability so the suite skips gracefully when `wrangler` is not installed. Without this, `vitest run` crashes at import time.
- `.gitignore`: added `packages/protocol/src/generated/validation/*.aot.ts` to match reference `.gitignore` (generated validator is intentionally not committed).

## Verification

- `npm install` completed (48 added, 0 vulnerabilities)
- `npm run build --workspace=@picompanion/protocol` → OK (generated `ws-outbound.aot.ts`, tsc)
- `npm run build --workspace=@picompanion/relay` → OK
- `npm run build --workspace=@picompanion/highlight` → OK
- `npm test --workspace=@picompanion/protocol` → 51 test files, 494 tests passed
- `npm test --workspace=@picompanion/relay` → 5 passed, 2 skipped (e2e skipped when wrangler absent)
- `npm test --workspace=@picompanion/highlight` → 4 test files, 67 tests passed
- No `D:\paseo` or `packages/app` import references in production code (only fixture data strings)

## License

All copied source remains AGPL-3.0-or-later, copyright Mohamed Boudra / Paseo project. Attribution to be consolidated in `THIRD_PARTY_NOTICES.md` by T05.
