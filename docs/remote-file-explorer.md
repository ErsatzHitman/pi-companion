# Remote file explorer

Browse, open, edit, create, upload, download, rename, and delete files on
the machine where the Pi agent (daemon) runs — from the web UI or the
Android app. No external file-manager server is embedded; the daemon's
own file-access surface already does this over the authenticated
session, so there is no second port, no second login, and no UI kit
that only runs on one platform.

## The configurable root

Every file RPC takes a `cwd` plus a root-relative `path`. That `cwd`
**is** the configurable root: pass your `codebases/` directory (or any
absolute daemon-side path the daemon process can read) as `cwd` from an
authenticated client, and every op is jailed inside it. `""` (or `"."`)
names the root itself. The agent-workspace browsers in both apps pass
the agent's workspace as `cwd`; a codebases browser passes the shared
folder instead — same messages, same jail, different root.

## Operations

| Op                                      | Wire messages                            | Client method                                                         |
| --------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| List directory                          | `file_explorer_request` (`mode: "list"`) | `listDirectory(cwd, path)`                                            |
| Read file (inline or binary frames)     | `file_explorer_request` (`mode: "file"`) | `readFile(cwd, path)`                                                 |
| Write file (optimistic concurrency)     | `fs.file.write.request`                  | `writeFile(input)`                                                    |
| Create directory (`mkdir -p`)           | `fs.file.mkdir.request`                  | `mkdir(cwd, path)`                                                    |
| Create file (never clobbers)            | `fs.file.create.request`                 | `createFile(cwd, path, content?)`                                     |
| Rename / move                           | `fs.file.rename.request`                 | `renameEntry(cwd, oldPath, newPath)`                                  |
| Delete (`recursive` for non-empty dirs) | `fs.file.delete.request`                 | `deleteEntry(cwd, path, recursive?)`                                  |
| Upload (binary frames, 100 MB cap)      | `file.upload.request`                    | `uploadFile(input)`                                                   |
| Download (short-lived token + HTTP GET) | `file_download_token_request`            | `requestDownloadToken(cwd, path)` → `GET /api/files/download?token=…` |
| Live updates                            | `fs.file.subscribe.request`              | file observer subscription                                            |

## Safety guarantees

All four new ops (and every existing one) go through one jail,
`resolveScopedPath` (`packages/server/src/server/file-explorer/
service.ts`): a lexical containment check first, then `realpath`
verification of both the root and the target, rejecting when the
resolved path escapes. Reads open with `O_NOFOLLOW` (except Windows,
which lacks it). The root itself can never be created, renamed, or
deleted; creates use `"wx"` so they fail instead of overwriting;
renames refuse occupied destinations; non-empty directories need an
explicit `recursive: true`. On web, every caller must pass each path
through `authorizeWorkspacePath` (`apps/web/src/features/files/
path-authorization.ts`) before the request — the existing hooks show
the pattern.

## Why no external project is embedded

| Option                                                           | Verdict                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| FileBrowser Quantum (Apache-2.0, full REST, per-user scope jail) | Best sidecar, but a second port plus duplicated JWT auth that can't share the session                      |
| SFTPGo (AGPL, richest API + S3/quotas)                           | Heaviest: own DB and protocols; only worth it for SFTP/S3 federation later                                 |
| DuFS / miniserve / copyparty (single-binary sidecars)            | Zero-friction jail, but still a sidecar with split auth, and WebDAV clients are painful on Android         |
| Chonky / SVAR / Syncfusion / Monaco (JS file-manager UIs)        | All DOM-only — none runs on React Native; Chonky is dead (2022), the rest are commercial or megabyte-scale |

The in-daemon surface wins: same port, same auth, same WebSocket
session, one shared model with separate web (DOM) and native
(`FlatList`) renderers. Revisit SFTPGo only if multi-protocol
(SFTP/FTPS) or S3-backed storage becomes a requirement.

## Wiring pointers

- Web: `FileOpsClient` (`apps/web/src/features/files/
file-ops-client.ts`) matches `DaemonClient` structurally — pass the
  live client straight in; `explainFileOpsError` covers the new
  guards with the same vocabulary as `explainFileBrowserError`.
- Android: the same four ops are optional members on
  `FileBrowserClient` (`apps/android/src/features/files/
file-browser-client.ts`) so existing test doubles keep compiling;
  `explainFileOpsError` there matches web's wording case for case.
- Server: `WorkspaceFilesSession` (`packages/server/src/server/
session/files/workspace-files-session.ts`) owns the four handlers;
  `session.ts` routes the four `fs.file.*` messages to them.
