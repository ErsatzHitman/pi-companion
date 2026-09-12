# T383 provenance — workspace checkpoint snapshots

This document records what T383 learned from Supernova and what it wrote fresh.
`packages/server/src/server/agent/checkpoints/` and the Pi provider's `revertFiles` /
`revertBoth` are a reimplementation, not a port. No file was copied verbatim.

## Source

- Repository: `D:\supernova` (MIT, Copyright (c) 2026 Mattia Cerutti).
- Commit read: `5e6b861d152e41d4fd715abe1dba92421d45c753` (2026-09-11, "chore: add
  question issue template").
- Read for BEHAVIOR only. Every file named below was read at that commit.

## Files read, by symbol

Supernova's files are named by path and the symbols that carry the behavior we adapted.
Our own shipped code cites `plan.md` §4.2 ("Workspace checkpoint snapshots"), never this
document and never the Supernova tree, per the T253 rule.

- `packages/agent-runtime/src/layers/session-runtime/internal/checkpoint-store.ts`
  - `WorkspaceCheckpointManifest`, `parseManifest` — the manifest shape, its ownership
    checks and its per-checkpoint repository list. Adopted as this repository's
    `WorkspaceCheckpointManifest` and `parseManifest` in `checkpoint-store.ts`.
  - `CheckpointStore.capture` / `captureProject` — capture every discovered repository,
    then publish a manifest; delete the refs already written when any capture failed.
    Adopted as `WorkspaceCheckpointStore.capture` / `captureProject`.
  - `CheckpointStore.restore` / `restoreProject` — load the current and target manifests,
    verify every ref, build one plan per repository, apply them in order and roll the
    applied ones back (reverse order) when one fails. Adopted as
    `WorkspaceCheckpointStore.restore` / `restoreProject`.
  - `defaultStorageRoot`, `projectStorageRoot`, `manifestPath` — storage under the daemon's
    own agent-data root, keyed by a digest of the canonical project root. Adopted with
    this repository's own root (`$PASEO_HOME/checkpoints`) and shortened digests (Windows
    Git refuses a `--git-dir` value near the platform path limit).
  - `KeyedMutex` per project root — adopted as an in-process per-workspace promise chain,
    so a capture and a restore never interleave.
  - `deleteSession` — delete one session's refs and manifests, leaving other sessions
    alone. Adopted as `WorkspaceCheckpointStore.deleteSession`.

- `packages/agent-runtime/src/layers/session-runtime/internal/shadow-repository.ts`
  - `MAX_UNTRACKED_FILE_BYTES` (2 MiB) — the untracked-file cap. Adopted, and additionally
    pinned by `checkpoint-store.test.ts`.
  - `checkpointRefName`, `digest`, `checkpointSessionRefPrefix` — private-ref naming.
    Reimplemented in `paths.ts` (`digest`, `shortDigest`, `checkpointRefName`,
    `checkpointSessionRefPrefix`) with a `refs/picompanion/checkpoints/` prefix.
  - `isWithin`, `slashPath`, `validateGitPath`, `isExcludedPath`, `topmostPaths` — path
    safety rules. Reimplemented in `paths.ts` and `exclusions.ts`.
  - `discoverRepositories` / `discoverCandidate` / `hasGitEntry` — find the workspace root
    and its immediate child repositories, give each a shadow repository, and exclude each
    child from its parent. Adopted.
  - `ensureShadowRepository` — create the shadow repository on first use and keep its
    `objects/info/alternates` pointed at the source object database, so checkpoint objects
    live in app-private storage while the user's repository gains nothing. Adopted.
  - `createSnapshotTree` — seed a private index from the user's own index, drop excluded
    child roots, clear `skip-worktree`/`assume-unchanged`, read status, rebuild the
    changed and untracked paths, and `write-tree`. Adopted.
  - `existingFilePaths` — keep only files and symlinks that exist, with the untracked size
    cap. Adopted, extended with a binary check (see "Our additions").
  - `withTemporaryIndex` / `seedIndex` — a private `GIT_INDEX_FILE` per operation, seeded
    from the user's index (including `sharedindex.*`). Adopted.
  - `CheckpointConflictError` — raised when the work tree no longer matches the current
    checkpoint on an affected path. Name and semantics adopted; this repository's copy
    carries a message that names `force`.
  - `buildRestorePlan` — diff the current and target trees, split the changes into
    delete/restore/affected, then build a safety tree that records the worktree's actual
    content for those paths; if it differs from the current checkpoint and `force` is not
    set, raise the conflict. Adopted.
  - `replaceTreePathsWithWorktree` — the safety-tree builder, also reused as the post-apply
    verification. Adopted.
  - `assertNoSymlinkAncestor`, `containsGitMetadata`, `removeWorktreePaths` — refuse to
    restore through a symlinked ancestor or to remove nested Git metadata. Adopted.
  - `applyRestorePlan` / `applyTree` / `rollbackRestorePlan` — remove affected paths,
    restore from the target tree with a private index, verify byte-for-byte, and roll back
    from the safety tree. Adopted.
  - `deleteSessionRefs` / `collectShadowGarbage` — session-scoped ref cleanup. Session
    ref cleanup adopted; garbage collection is folded into a `collectGarbage` helper that
    is not yet called from a session path.

- `packages/agent-runtime/src/layers/session-runtime/internal/git/git-commands.ts`
  - `PINNED_CONFIG` / `SYMLINKS_MODE` — pin `core.autocrlf`, `core.fsmonitor`,
    `core.longpaths` and `core.symlinks` so a user's global config cannot change what a
    snapshot contains. Adopted verbatim as `PINNED_GIT_CONFIG` (the values, not the code).
  - `readRepositoryInfo` — one `rev-parse` for top-level, bare flag, git dir, object
    format, object dir and index path. Adopted.
  - `createShadowRepository` — `git init --bare --object-format=...` plus the pinned
    config and a prune window. Adopted.
  - `listFlaggedPaths`, `clearIndexFlags` — find and clear `skip-worktree` /
    `assume-unchanged`, which would otherwise hide worktree changes. Adopted.
  - `readWorkspaceStatus` — `status --porcelain=v2 -z --no-renames
--ignore-submodules=all --untracked-files=all --ignored=no`, with the
    `fieldAfterSpaces` record parser. Adopted.
  - `removeCachedPaths`, `removeIndexPaths`, `addPaths`, `readTree`, `readEmptyTree`,
    `writeTree`, `diffTrees`, `listTreePaths`, `restoreWorktreePaths` — the index and tree
    plumbing behind a snapshot and a restore. Adopted.
  - `writeRef`, `deleteRef`, `listRefs`, `resolveRefTree`, `collectGarbage` — ref
    plumbing. Adopted.

- `packages/agent-runtime/src/layers/session-runtime/lib/checkpoints/checkpoint-keys.ts`
  - `digest` — sha256 identifier hashing. Adopted (`paths.ts`).
- `.../lib/checkpoints/checkpoint-entries.ts`
  - `CheckpointPhase` (`"before-turn" | "after-turn"`), `CheckpointStatus`,
    `isCheckpointEntry`, `isCheckpointAfterTurnEntry`, `isCapturedCheckpoint`,
    `latestCheckpointCursor`, `invalidateCheckpointRedo` — read to understand that a
    checkpoint is attached to a turn boundary and that a cursor tracks the visible one.
    Our implementation records the same phase vocabulary and takes the snapshot at the
    same boundaries, but keeps the turn→checkpoint mapping in the daemon process instead
    of writing custom entries into Pi's session tree (no new Pi extension surface).
- `.../lib/checkpoints/git-paths.ts`
  - `slashPath`, `isWithin`, `validateGitPath`, `isExcludedPath`, `topmostPaths` —
    reimplemented in `paths.ts` and `exclusions.ts`.
- `.../operations/checkpoint/undo-checkpoint.ts`
  - `undoCheckpoint`, `findUndoTarget` — the "undo moves back to the checkpoint before the
    previous user message" rule. Read and matched in spirit: T383 restores the snapshot
    taken before the rewound turn.
- `.../operations/checkpoint/revert-to-message.ts`
  - `revertToMessage`, `findCheckpointBefore`, `findCheckpointAfter` — the decision that a
    visible target restores the checkpoint BEFORE the user message. Adopted as
    `revertFiles`'s choice of the `before-turn` snapshot for the rewound message.
- `.../operations/checkpoint/redo-checkpoint.ts`
  - `redoCheckpoint`, `findRedoTarget` — read for completeness; redo is out of scope for
    T383 and is not implemented.
- `packages/contracts/src/session-runtime/procedures/checkpoints.ts`
  - `force`, `RevertToMessagePayload`, `CheckpointConflictError` (the tagged error class)
    — the contract that a restore carries an optional `force` and that a conflict is a
    distinct, retryable error. Adopted as the optional `force` field on
    `AgentRewindRequestMessageSchema` and this repository's `CheckpointConflictError`.

## Not adopted

Supernova's checkpoint code is entangled with Effect RPC, Bun and an Electron shell. None
of that entered this repository: the store here is plain TypeScript on `node:fs/promises`,
this repository's own process spawner, and Zod schemas that already existed. No new
dependency was added. The session-tree custom entries and the redo cursor are not
implemented (T383's shape is per-turn snapshots plus a conflict-checked restore).

## Our additions beyond the Supernova rules

Pinned by `packages/server/src/server/agent/checkpoints/checkpoint-store.test.ts`:

- a `node_modules` segment is excluded at any depth, in addition to `.git` and child
  repository roots;
- a large binary untracked file (a NUL byte in its leading bytes, above a 1 MiB cap) is
  excluded;
- a tracked file is never size-capped, because excluding a tracked path would make a later
  restore delete it;
- a shortened digest is used for storage directory and ref names (Windows Git refuses a
  `--git-dir` value near the platform path limit).

## Paseo check

None of the files named above is derived from Paseo's `packages/app` (the plan §5 ban).
Verification: `grep -rli "paseo\|picompanion" packages/agent-runtime packages/contracts`
in the Supernova checkout returned no match; the read files import only `node:*`,
`effect`, `@earendil-works/pi-coding-agent` and `@supernova/*` internal packages. The
Supernova license is MIT and the repository is independent of Paseo; nothing was copied
verbatim, so no Paseo-derived code was laundered through it.
