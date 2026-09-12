/**
 * Low-level Git plumbing for workspace checkpoints.
 *
 * A checkpoint never touches the user's index, HEAD, refs or staged work: every
 * operation runs against an app-owned shadow repository (`--git-dir`) paired with
 * the user's work tree (`--work-tree`) and a private, temporary index
 * (`GIT_INDEX_FILE`). The semantics this module implements are recorded in
 * `plan.md` §4.2 ("Workspace checkpoint snapshots").
 *
 * Adapted from Supernova's `packages/agent-runtime/src/layers/session-runtime/
 * internal/git/git-commands.ts` (symbols `GitTarget`, `readRepositoryInfo`,
 * `createShadowRepository`, `readWorkspaceStatus`, `writeTree`, `diffTrees`,
 * `restoreWorktreePaths`, `writeRef`), MIT © 2026 Mattia Cerutti, read at commit
 * `5e6b861d152e41d4fd715abe1dba92421d45c753`; see `docs/T383-provenance.md`.
 * Reimplemented on this repository's own process spawner; nothing copied verbatim.
 */

import { spawnProcess } from "../../../utils/spawn.js";

const HASH_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;

/**
 * Symlink support is pinned off on Windows, where creating symlinks needs an
 * elevation Git for Windows usually lacks; pinning it on there would make every
 * restore that writes a symlink fail.
 */
const SYMLINKS_MODE = process.platform === "win32" ? "false" : "true";

/**
 * Config pinned on every checkpoint command so a user's global settings cannot
 * change what a snapshot contains: line-ending conversion and the filesystem
 * monitor (which would consult a daemon for the user's work tree) are both
 * forced off.
 */
export const PINNED_GIT_CONFIG: readonly string[] = [
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.longpaths=true",
  "-c",
  `core.symlinks=${SYMLINKS_MODE}`,
];

export type GitObjectFormat = "sha1" | "sha256";

/** A shadow repository paired with the user work tree its commands operate on. */
export interface GitTarget {
  readonly gitDir: string;
  readonly worktree: string;
}

export interface RepositoryInfo {
  readonly bare: boolean;
  readonly gitDir: string;
  readonly indexPath: string;
  readonly objectDir: string;
  readonly objectFormat: GitObjectFormat;
  readonly topLevel: string;
}

export interface TreeChange {
  readonly deleted: boolean;
  readonly path: string;
}

export interface WorkspaceStatus {
  readonly changed: readonly string[];
  readonly untracked: readonly string[];
}

interface GitInvocation {
  readonly cwd: string;
  readonly envOverlay?: Record<string, string>;
  readonly input?: Buffer | string;
}

/**
 * Runs one git command, writing `input` to stdin when present, and throws with
 * git's own stderr when it exits non-zero. Output is collected whole; the caps
 * above bound a runaway tree listing without truncating a real one.
 */
async function runGit(args: string[], invocation: GitInvocation): Promise<string> {
  const child = spawnProcess("git", [...PINNED_GIT_CONFIG, ...args], {
    cwd: invocation.cwd,
    envOverlay: {
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      ...invocation.envOverlay,
    },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let totalBytes = 0;
  let overflowed = false;

  if (invocation.input !== undefined) {
    child.stdin?.end(invocation.input);
  } else {
    child.stdin?.end();
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    totalBytes += chunk.length;
    if (totalBytes > GIT_MAX_OUTPUT_BYTES) {
      overflowed = true;
      child.kill("SIGKILL");
      return;
    }
    stdout.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 64) {
      stderr.push(chunk);
    }
  });

  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, GIT_TIMEOUT_MS);
  timeout.unref?.();

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  }).finally(() => clearTimeout(timeout));

  if (overflowed) {
    throw new Error("A checkpoint Git command produced too much output.");
  }
  if (exitCode !== 0) {
    const detail = Buffer.concat(stderr).toString("utf8").trim();
    throw new Error(`git ${args[0] ?? ""} failed: ${detail || `exit ${exitCode}`}`);
  }
  return Buffer.concat(stdout).toString("utf8");
}

/** Runs git, returning `undefined` instead of throwing when the command fails. */
async function optionalGit(args: string[], invocation: GitInvocation): Promise<string | undefined> {
  try {
    return await runGit(args, invocation);
  } catch {
    return undefined;
  }
}

function targetArgs(target: GitTarget, args: readonly string[]): string[] {
  return [`--git-dir=${target.gitDir}`, `--work-tree=${target.worktree}`, ...args];
}

function indexEnv(indexPath: string): Record<string, string> {
  return { GIT_INDEX_FILE: indexPath };
}

function nulRecords(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function nulPaths(paths: readonly string[]): Buffer {
  return Buffer.from(`${paths.join("\0")}\0`);
}

/**
 * Literal, top-anchored pathspecs, so nothing in a user file name is ever
 * interpreted as a glob pattern by Git.
 */
function pathspecs(paths: readonly string[]): Buffer {
  return Buffer.from(`${paths.map((path) => `:(top,literal)${path}`).join("\0")}\0`);
}

/**
 * Returns the remainder of a record after the given number of spaces, which is
 * how `git status --porcelain=v2` delimits its fields from the path.
 */
function fieldAfterSpaces(record: string, spaces: number): string | undefined {
  let offset = -1;
  for (let count = 0; count < spaces; count += 1) {
    offset = record.indexOf(" ", offset + 1);
    if (offset === -1) {
      return undefined;
    }
  }
  return record.slice(offset + 1) || undefined;
}

/**
 * Reads every repository property a capture needs in one invocation, because
 * spawning Git once per candidate directory is the cost that matters.
 */
export async function readRepositoryInfo(directory: string): Promise<RepositoryInfo | undefined> {
  const output = await optionalGit(
    [
      "-C",
      directory,
      "rev-parse",
      "--show-toplevel",
      "--is-bare-repository",
      "--absolute-git-dir",
      "--show-object-format",
      "--path-format=absolute",
      "--git-path",
      "objects",
      "--git-path",
      "index",
    ],
    { cwd: directory },
  );
  const [topLevel, bare, gitDir, objectFormat, objectDir, indexPath] =
    output?.split("\n").map((line) => line.trim()) ?? [];
  if (!topLevel || !bare || !gitDir || !objectDir || !indexPath) {
    return undefined;
  }
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    throw new Error("Workspace checkpointing does not support this Git object format.");
  }
  return { bare: bare === "true", gitDir, indexPath, objectDir, objectFormat, topLevel };
}

/** Creates the app-owned bare repository that stores checkpoint objects and refs. */
export async function createShadowRepository(
  gitDir: string,
  objectFormat: GitObjectFormat,
  parentDirectory: string,
): Promise<void> {
  await runGit(["init", "--bare", `--object-format=${objectFormat}`, gitDir], {
    cwd: parentDirectory,
  });
  const settings: ReadonlyArray<readonly [string, string]> = [
    ["gc.pruneExpire", "7.days"],
    ["core.autocrlf", "false"],
    ["core.fsmonitor", "false"],
    ["core.longpaths", "true"],
    ["core.symlinks", SYMLINKS_MODE],
  ];
  for (const [key, value] of settings) {
    await runGit([`--git-dir=${gitDir}`, "config", key, value], { cwd: parentDirectory });
  }
}

/** Returns index entries carrying `skip-worktree` or `assume-unchanged`, which hide work-tree changes. */
export async function listFlaggedPaths(
  target: GitTarget,
  indexPath: string,
): Promise<readonly string[]> {
  const output = await runGit(targetArgs(target, ["ls-files", "-v", "-z"]), {
    cwd: target.worktree,
    envOverlay: indexEnv(indexPath),
  });
  return nulRecords(output)
    .filter((record) => /^(?:S|[a-z]) /.test(record))
    .map((record) => record.slice(2));
}

/** Clears both flags that would hide work-tree changes. The two options cannot be combined in one call. */
export async function clearIndexFlags(
  target: GitTarget,
  indexPath: string,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  const invocation = {
    cwd: target.worktree,
    envOverlay: indexEnv(indexPath),
    input: nulPaths(paths),
  };
  await runGit(
    targetArgs(target, ["update-index", "--no-skip-worktree", "-z", "--stdin"]),
    invocation,
  );
  await runGit(
    targetArgs(target, ["update-index", "--no-assume-unchanged", "-z", "--stdin"]),
    invocation,
  );
}

/** Reports work-tree changes, staged deletions and untracked paths, refreshing the index as it goes. */
export async function readWorkspaceStatus(
  target: GitTarget,
  indexPath: string,
): Promise<WorkspaceStatus> {
  const output = await runGit(
    targetArgs(target, [
      "status",
      "--porcelain=v2",
      "-z",
      "--no-renames",
      "--ignore-submodules=all",
      "--untracked-files=all",
      "--ignored=no",
    ]),
    { cwd: target.worktree, envOverlay: indexEnv(indexPath) },
  );
  const changed = new Set<string>();
  const untracked: string[] = [];
  const records = nulRecords(output);

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.startsWith("? ")) {
      untracked.push(record.slice(2));
      continue;
    }
    if (record.startsWith("1 ")) {
      const path = fieldAfterSpaces(record, 8);
      // A staged deletion never differs from the index, so no work-tree
      // comparison would report it.
      if (path && (record[3] !== "." || record[2] === "D")) {
        changed.add(path);
      }
      continue;
    }
    if (record.startsWith("u ")) {
      const path = fieldAfterSpaces(record, 10);
      if (path) {
        changed.add(path);
      }
      continue;
    }
    // Renames are disabled, but a rename record would carry its original path
    // in a second record.
    if (record.startsWith("2 ")) {
      index += 1;
    }
  }

  return { changed: [...changed], untracked };
}

/** Drops paths and their children from the index without touching the work tree. */
export async function removeCachedPaths(
  target: GitTarget,
  indexPath: string,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  await runGit(
    targetArgs(target, [
      "rm",
      "-r",
      "--cached",
      "--ignore-unmatch",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
    ]),
    {
      cwd: target.worktree,
      envOverlay: indexEnv(indexPath),
      input: pathspecs(paths),
    },
  );
}

/** Drops index entries so a rebuilt tree represents deletions by absence. */
export async function removeIndexPaths(
  target: GitTarget,
  indexPath: string,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  await runGit(targetArgs(target, ["update-index", "--force-remove", "-z", "--stdin"]), {
    cwd: target.worktree,
    envOverlay: indexEnv(indexPath),
    input: nulPaths(paths),
  });
}

/** Stages work-tree content for the given paths, including files Git would otherwise ignore. */
export async function addPaths(
  target: GitTarget,
  indexPath: string,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  await runGit(
    targetArgs(target, ["add", "-f", "--sparse", "--pathspec-from-file=-", "--pathspec-file-nul"]),
    {
      cwd: target.worktree,
      envOverlay: indexEnv(indexPath),
      input: pathspecs(paths),
    },
  );
}

/** Replaces the index contents with a tree. */
export async function readTree(
  target: GitTarget,
  indexPath: string,
  treeId: string,
): Promise<void> {
  await runGit(targetArgs(target, ["read-tree", treeId]), {
    cwd: target.worktree,
    envOverlay: indexEnv(indexPath),
  });
}

/** Empties the index, used when no source index could be copied. */
export async function readEmptyTree(target: GitTarget, indexPath: string): Promise<void> {
  await runGit(targetArgs(target, ["read-tree", "--empty"]), {
    cwd: target.worktree,
    envOverlay: indexEnv(indexPath),
  });
}

/** Writes the index as a tree object and returns its id. */
export async function writeTree(target: GitTarget, indexPath: string): Promise<string> {
  const treeId = (
    await runGit(targetArgs(target, ["write-tree"]), {
      cwd: target.worktree,
      envOverlay: indexEnv(indexPath),
    })
  ).trim();
  if (!HASH_PATTERN.test(treeId)) {
    throw new Error("Git returned an invalid checkpoint tree id.");
  }
  return treeId;
}

/** Lists the paths that differ between two trees, without rename detection. */
export async function diffTrees(
  target: GitTarget,
  fromTreeId: string,
  toTreeId: string,
): Promise<readonly TreeChange[]> {
  const output = await runGit(
    targetArgs(target, ["diff", "--name-status", "--no-renames", "-z", fromTreeId, toTreeId]),
    { cwd: target.worktree },
  );
  const fields = nulRecords(output);
  const changes: TreeChange[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (status && path) {
      changes.push({ deleted: status.startsWith("D"), path });
    }
  }
  return changes;
}

/** Lists every path contained in a tree. */
export async function listTreePaths(target: GitTarget, treeId: string): Promise<readonly string[]> {
  const output = await runGit(
    targetArgs(target, ["ls-tree", "-r", "--name-only", "-z", treeId, "--"]),
    {
      cwd: target.worktree,
    },
  );
  return nulRecords(output);
}

/** Writes tree content for the given paths into the work tree. */
export async function restoreWorktreePaths(
  target: GitTarget,
  indexPath: string,
  treeId: string,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  const envOverlay = indexEnv(indexPath);
  await runGit(targetArgs(target, ["read-tree", treeId]), { cwd: target.worktree, envOverlay });
  await runGit(
    targetArgs(target, [
      "restore",
      "--source",
      treeId,
      "--worktree",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
    ]),
    { cwd: target.worktree, envOverlay, input: pathspecs(paths) },
  );
}

/** Points a ref at an object id. */
export async function writeRef(gitDir: string, ref: string, objectId: string): Promise<void> {
  await runGit([`--git-dir=${gitDir}`, "update-ref", ref, objectId], { cwd: gitDir });
}

/** Deletes a ref, ignoring a ref that is already gone. */
export async function deleteRef(gitDir: string, ref: string): Promise<void> {
  await optionalGit([`--git-dir=${gitDir}`, "update-ref", "-d", ref], { cwd: gitDir });
}

/** Lists refs under a prefix. */
export async function listRefs(gitDir: string, prefix: string): Promise<readonly string[]> {
  const output = await optionalGit(
    [`--git-dir=${gitDir}`, "for-each-ref", "--format=%(refname)", prefix],
    { cwd: gitDir },
  );
  return output ? output.split("\n").filter(Boolean) : [];
}

/** Resolves the tree a ref points at. */
export async function resolveRefTree(gitDir: string, ref: string): Promise<string> {
  return (
    await runGit([`--git-dir=${gitDir}`, "rev-parse", `${ref}^{tree}`], { cwd: gitDir })
  ).trim();
}

/** Packs and prunes a shadow repository, ignoring failures because maintenance is best-effort. */
export async function collectGarbage(gitDir: string): Promise<void> {
  await optionalGit([`--git-dir=${gitDir}`, "gc", "--prune=7.days"], { cwd: gitDir });
}
