/**
 * App-private shadow repositories behind workspace checkpoints.
 *
 * Each discovered work tree gets its own bare shadow repository under the
 * daemon's private checkpoint storage. Objects are written there (via a private
 * temporary index) and read from the source repository through Git's
 * `objects/info/alternates`, so a snapshot never adds a ref, object or index
 * entry to the user's repository and never moves its HEAD.
 *
 * The semantics this module implements are recorded in `plan.md` §4.2
 * ("Workspace checkpoint snapshots").
 *
 * Adapted from Supernova's `packages/agent-runtime/src/layers/session-runtime/
 * internal/shadow-repository.ts` (symbols `discoverRepositories`,
 * `captureRepository`, `buildRestorePlan`, `applyRestorePlan`,
 * `rollbackRestorePlan`, `CheckpointConflictError`), MIT © 2026 Mattia Cerutti,
 * read at commit `5e6b861d152e41d4fd715abe1dba92421d45c753`; the Supernova source
 * it was reimplemented from is named in `docs/T383-provenance.md`.
 */

import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

import { isExcludedPath, shouldCaptureFile } from "./exclusions.js";
import {
  addPaths,
  clearIndexFlags,
  createShadowRepository,
  deleteRef,
  diffTrees,
  listFlaggedPaths,
  listRefs,
  listTreePaths,
  readEmptyTree,
  readRepositoryInfo,
  readTree,
  readWorkspaceStatus,
  removeCachedPaths,
  removeIndexPaths,
  resolveRefTree,
  restoreWorktreePaths,
  writeRef,
  writeTree,
} from "./git-commands.js";
import type { GitObjectFormat, GitTarget } from "./git-commands.js";
import {
  checkpointRefName,
  checkpointSessionRefPrefix,
  digest,
  isWithin,
  shortDigest,
  slashPath,
  topmostPaths,
  validateGitPath,
} from "./paths.js";

const BINARY_SNIFF_BYTES = 8_000;

/** Raised when the work tree no longer matches the current checkpoint on a path the restore would change. */
export class CheckpointConflictError extends Error {
  public constructor() {
    super(
      "The workspace changed after the checkpoint was taken. Re-run the rewind with force to discard those changes.",
    );
    this.name = "CheckpointConflictError";
  }
}

interface RepositoryIdentity {
  readonly gitDir: string;
  readonly objectDir: string;
  readonly objectFormat: GitObjectFormat;
  readonly relativeRoot: string;
  readonly repositoryId: string;
  readonly root: string;
  readonly sourceIndexPath: string;
}

export interface DiscoveredRepository extends RepositoryIdentity {
  readonly excludedRoots: readonly string[];
  readonly shadowGitDir: string;
}

export interface RepositoryCheckpointState {
  readonly refName: string;
  readonly relativeRoot: string;
  readonly repositoryId: string;
  readonly treeId: string;
}

export interface RepositoryRestorePlan {
  readonly affectedPaths: readonly string[];
  readonly deletePaths: readonly string[];
  readonly repository: DiscoveredRepository;
  readonly restorePaths: readonly string[];
  readonly safetyTreeId: string;
  readonly targetTreeId: string;
}

function shadowTarget(repository: DiscoveredRepository): GitTarget {
  return { gitDir: repository.shadowGitDir, worktree: repository.root };
}

/** Cheap check that avoids spawning Git for directories that cannot be a work-tree root. */
async function hasGitEntry(candidate: string): Promise<boolean> {
  try {
    await lstat(join(candidate, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function discoverCandidate(
  candidate: string,
  workspaceRoot: string,
): Promise<RepositoryIdentity | undefined> {
  let canonicalCandidate: string;
  try {
    canonicalCandidate = await realpath(candidate);
    if (!(await stat(canonicalCandidate)).isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const info = await readRepositoryInfo(canonicalCandidate);
  if (!info || info.bare) {
    return undefined;
  }

  let canonicalTopLevel: string;
  try {
    canonicalTopLevel = await realpath(info.topLevel);
  } catch {
    return undefined;
  }
  // A directory inside a repository reports that repository's root, so only the
  // root itself is a candidate.
  if (canonicalTopLevel !== canonicalCandidate) {
    return undefined;
  }
  if (!isWithin(workspaceRoot, canonicalCandidate)) {
    return undefined;
  }

  const [gitDir, objectDir] = await Promise.all([realpath(info.gitDir), realpath(info.objectDir)]);
  const gitDirMetadata = await stat(gitDir);
  // Some filesystems report ctime as the birth time, and a Git directory's ctime
  // changes on ordinary activity. Zero keeps the identity stable there at the
  // cost of inode-only precision.
  const birthTime =
    gitDirMetadata.birthtimeMs === gitDirMetadata.ctimeMs ? 0 : gitDirMetadata.birthtimeMs;
  const projectRelativeRoot = relative(workspaceRoot, canonicalCandidate);

  return {
    gitDir,
    objectDir,
    objectFormat: info.objectFormat,
    relativeRoot: projectRelativeRoot === "" ? "." : slashPath(projectRelativeRoot),
    repositoryId: digest(`${canonicalCandidate}\0${gitDir}\0${gitDirMetadata.ino}\0${birthTime}`),
    root: canonicalCandidate,
    sourceIndexPath: info.indexPath,
  };
}

/** Finds the workspace root and its immediate child repositories, and assigns each one its shadow storage. */
export async function discoverRepositories(
  workspaceRoot: string,
  repositoriesRoot: string,
): Promise<readonly DiscoveredRepository[]> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(workspaceRoot);
    if (!(await stat(canonicalRoot)).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const candidates = [canonicalRoot];
  const children = await readdir(canonicalRoot, { withFileTypes: true }).catch(() => []);
  for (const child of children) {
    if (child.isDirectory() && child.name !== "node_modules") {
      candidates.push(join(canonicalRoot, child.name));
    }
  }

  const repositoryCandidates = (
    await Promise.all(
      candidates.map(async (candidate) => ((await hasGitEntry(candidate)) ? candidate : undefined)),
    )
  ).filter((candidate): candidate is string => candidate !== undefined);

  const discovered = (
    await Promise.all(
      repositoryCandidates.map((candidate) => discoverCandidate(candidate, canonicalRoot)),
    )
  ).filter((repository): repository is RepositoryIdentity => repository !== undefined);
  discovered.sort((left, right) => left.relativeRoot.localeCompare(right.relativeRoot));

  return discovered.map((repository) => {
    const excludedRoots = discovered
      .filter(
        (candidate) =>
          candidate.root !== repository.root && dirname(candidate.root) === repository.root,
      )
      .map((candidate) => slashPath(relative(repository.root, candidate.root)));
    return {
      ...repository,
      excludedRoots: [...excludedRoots, "node_modules"],
      shadowGitDir: join(repositoriesRoot, shortDigest(repository.repositoryId), "git"),
    };
  });
}

/** Creates the shadow repository on first use and keeps it pointed at the source object database. */
async function ensureShadowRepository(repository: DiscoveredRepository): Promise<void> {
  await mkdir(dirname(repository.shadowGitDir), { recursive: true });
  let initialized = true;
  try {
    await stat(join(repository.shadowGitDir, "HEAD"));
  } catch {
    initialized = false;
  }

  if (!initialized) {
    await createShadowRepository(
      repository.shadowGitDir,
      repository.objectFormat,
      dirname(repository.shadowGitDir),
    );
  }
  await mkdir(join(repository.shadowGitDir, "objects", "info"), { recursive: true });
  await writeFile(
    join(repository.shadowGitDir, "objects", "info", "alternates"),
    `${repository.objectDir}\n`,
  );
}

async function isBinaryFile(absolutePath: string): Promise<boolean> {
  const handle = await open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(BINARY_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

/**
 * Filters candidate paths down to files and symlinks that exist now, dropping
 * excluded and over-cap paths. Tracked candidates are never size-capped: they are
 * part of the repository, so excluding one would make a later restore delete it.
 */
async function existingFilePaths(
  paths: readonly string[],
  root: string,
  excludedRoots: readonly string[],
  options: { readonly untracked: boolean },
): Promise<readonly string[]> {
  const files: string[] = [];
  for (const path of paths) {
    const absolutePath = join(root, ...path.split("/"));
    let metadata;
    try {
      metadata = await lstat(absolutePath);
    } catch {
      continue;
    }
    if (!metadata.isFile() && !metadata.isSymbolicLink()) {
      continue;
    }
    const candidate = {
      binary: metadata.isSymbolicLink() ? false : await isBinaryFile(absolutePath),
      path,
      size: metadata.size,
      untracked: options.untracked,
    };
    if (shouldCaptureFile(candidate, excludedRoots)) {
      files.push(path);
    }
  }
  return files;
}

/** Runs work against a private index, so no checkpoint operation shares mutable index state. */
async function withTemporaryIndex<T>(run: (indexPath: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "picompanion-checkpoint-"));
  try {
    return await run(join(directory, "index"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

/** Seeds the private index from the user's index, which reuses its object ids and cached file metadata. */
async function seedIndex(
  repository: DiscoveredRepository,
  target: GitTarget,
  indexPath: string,
): Promise<void> {
  try {
    await copyFile(repository.sourceIndexPath, indexPath);
    const sourceIndexDirectory = dirname(repository.sourceIndexPath);
    const sharedIndexes = (await readdir(sourceIndexDirectory)).filter((name) =>
      name.startsWith("sharedindex."),
    );
    await Promise.all(
      sharedIndexes.map((name) =>
        copyFile(join(sourceIndexDirectory, name), join(dirname(indexPath), name)).catch(
          () => undefined,
        ),
      ),
    );
  } catch {
    await readEmptyTree(target, indexPath);
  }
}

/** Builds a tree describing the current work tree, excluding paths owned by a child repository. */
async function createSnapshotTree(repository: DiscoveredRepository): Promise<string> {
  await ensureShadowRepository(repository);
  const target = shadowTarget(repository);

  return withTemporaryIndex(async (indexPath) => {
    await seedIndex(repository, target, indexPath);
    await removeCachedPaths(target, indexPath, repository.excludedRoots);
    await clearIndexFlags(target, indexPath, await listFlaggedPaths(target, indexPath));

    const status = await readWorkspaceStatus(target, indexPath);
    const changed = status.changed.filter(
      (path) => !isExcludedPath(path, repository.excludedRoots),
    );
    const untracked = status.untracked.filter(
      (path) => !isExcludedPath(path, repository.excludedRoots),
    );
    const trackedFiles = await existingFilePaths(
      changed,
      repository.root,
      repository.excludedRoots,
      {
        untracked: false,
      },
    );
    const untrackedFiles = await existingFilePaths(
      untracked,
      repository.root,
      repository.excludedRoots,
      { untracked: true },
    );

    // Removing first lets a rebuilt entry represent a deletion, a mode change,
    // or a type change.
    await removeIndexPaths(target, indexPath, changed);
    await addPaths(target, indexPath, [...new Set([...trackedFiles, ...untrackedFiles])]);

    return writeTree(target, indexPath);
  });
}

/** Captures one repository and publishes the private ref that pins its tree. */
export async function captureRepository(
  repository: DiscoveredRepository,
  sessionId: string,
  checkpointId: string,
): Promise<RepositoryCheckpointState> {
  const treeId = await createSnapshotTree(repository);
  const refName = checkpointRefName(sessionId, checkpointId);
  await writeRef(repository.shadowGitDir, refName, treeId);
  return {
    refName,
    relativeRoot: repository.relativeRoot,
    repositoryId: repository.repositoryId,
    treeId,
  };
}

/** Removes a checkpoint ref, used to clean up after an incomplete capture. */
export async function deleteCheckpointRef(
  repository: Pick<DiscoveredRepository, "shadowGitDir">,
  ref: string,
): Promise<void> {
  await deleteRef(repository.shadowGitDir, ref);
}

/** Confirms a manifest's ref still resolves to the tree the manifest recorded. */
export async function verifyCheckpointRef(
  repository: DiscoveredRepository,
  state: RepositoryCheckpointState,
): Promise<void> {
  await ensureShadowRepository(repository);
  if ((await resolveRefTree(repository.shadowGitDir, state.refName)) !== state.treeId) {
    throw new Error("A checkpoint ref no longer resolves to its recorded tree.");
  }
}

/** Returns whether the current work tree already matches a tree. */
export async function repositoryMatchesTree(
  repository: DiscoveredRepository,
  treeId: string,
): Promise<boolean> {
  return (await createSnapshotTree(repository)) === treeId;
}

async function assertNoSymlinkAncestor(repositoryRoot: string, path: string): Promise<void> {
  const segments = path.split("/");
  let current = repositoryRoot;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch {
      return;
    }
    if (metadata.isSymbolicLink()) {
      throw new Error("A checkpoint path has a symbolic-link ancestor.");
    }
    if (!metadata.isDirectory()) {
      return;
    }
  }
}

/** Writes a tree whose affected paths carry the work tree's actual current content. */
async function replaceTreePathsWithWorktree(
  repository: DiscoveredRepository,
  baseTreeId: string,
  affectedPaths: readonly string[],
): Promise<string> {
  for (const path of affectedPaths) {
    await assertNoSymlinkAncestor(repository.root, path);
  }
  const target = shadowTarget(repository);

  return withTemporaryIndex(async (indexPath) => {
    await readTree(target, indexPath, baseTreeId);
    await removeIndexPaths(target, indexPath, affectedPaths);
    await addPaths(
      target,
      indexPath,
      await existingFilePaths(affectedPaths, repository.root, repository.excludedRoots, {
        untracked: false,
      }),
    );
    return writeTree(target, indexPath);
  });
}

/**
 * Plans one repository's restore and detects manual changes before anything is written.
 *
 * The safety tree records the work tree's actual state for the affected paths.
 * When it differs from the current checkpoint, an affected path was changed by
 * hand, which `force` discards.
 */
export async function buildRestorePlan(
  repository: DiscoveredRepository,
  current: RepositoryCheckpointState,
  target: RepositoryCheckpointState,
  force: boolean,
): Promise<RepositoryRestorePlan> {
  const changes = (await diffTrees(shadowTarget(repository), current.treeId, target.treeId)).filter(
    (change) => !isExcludedPath(change.path, repository.excludedRoots),
  );
  for (const change of changes) {
    validateGitPath(change.path);
  }

  const deletePaths = changes.filter((change) => change.deleted).map((change) => change.path);
  const restorePaths = changes.filter((change) => !change.deleted).map((change) => change.path);
  const affectedPaths = [...new Set([...deletePaths, ...restorePaths])].sort();
  const safetyTreeId = await replaceTreePathsWithWorktree(
    repository,
    current.treeId,
    affectedPaths,
  );
  if (safetyTreeId !== current.treeId && !force) {
    throw new CheckpointConflictError();
  }

  return {
    affectedPaths,
    deletePaths,
    repository,
    restorePaths,
    safetyTreeId,
    targetTreeId: target.treeId,
  };
}

async function containsGitMetadata(path: string): Promise<boolean> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    return false;
  }
  if (basename(path) === ".git") {
    return true;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    return false;
  }
  const children = await readdir(path);
  for (const child of children) {
    if (await containsGitMetadata(join(path, child))) {
      return true;
    }
  }
  return false;
}

/** Removes affected paths before restoring, which is what makes file and directory transitions work. */
async function removeWorktreePaths(
  repository: DiscoveredRepository,
  paths: readonly string[],
): Promise<void> {
  for (const path of topmostPaths(paths)) {
    validateGitPath(path);
    await assertNoSymlinkAncestor(repository.root, path);
    const absolutePath = resolve(repository.root, ...path.split("/"));
    if (!isWithin(repository.root, absolutePath)) {
      throw new Error("A checkpoint path escapes its repository.");
    }
    if (await containsGitMetadata(absolutePath)) {
      throw new Error("A checkpoint restore would remove nested Git metadata.");
    }
    await rm(absolutePath, { force: true, recursive: true });
  }
}

async function applyTree(
  repository: DiscoveredRepository,
  treeId: string,
  affectedPaths: readonly string[],
  restorePaths: readonly string[],
): Promise<void> {
  await removeWorktreePaths(repository, affectedPaths);
  await withTemporaryIndex((indexPath) =>
    restoreWorktreePaths(shadowTarget(repository), indexPath, treeId, restorePaths),
  );
}

/** Applies one repository's plan and verifies the affected paths match the target tree exactly. */
export async function applyRestorePlan(plan: RepositoryRestorePlan): Promise<void> {
  await applyTree(plan.repository, plan.targetTreeId, plan.affectedPaths, plan.restorePaths);
  const verificationTreeId = await replaceTreePathsWithWorktree(
    plan.repository,
    plan.targetTreeId,
    plan.affectedPaths,
  );
  if (verificationTreeId !== plan.targetTreeId) {
    throw new Error("Workspace checkpoint verification failed.");
  }
}

/** Restores affected paths from the plan's safety tree after a failed apply. */
export async function rollbackRestorePlan(plan: RepositoryRestorePlan): Promise<void> {
  const treePathSet = new Set(
    await listTreePaths(shadowTarget(plan.repository), plan.safetyTreeId),
  );
  const restorePaths = plan.affectedPaths.filter((path) => treePathSet.has(path));
  await applyTree(plan.repository, plan.safetyTreeId, plan.affectedPaths, restorePaths);
}

async function listShadowGitDirs(repositoriesRoot: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(repositoriesRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(repositoriesRoot, entry.name, "git"));
  } catch {
    return [];
  }
}

/** Removes every checkpoint ref owned by one session, leaving other sessions untouched. */
export async function deleteSessionRefs(
  repositoriesRoot: string,
  sessionId: string,
): Promise<void> {
  const prefix = checkpointSessionRefPrefix(sessionId);
  for (const gitDir of await listShadowGitDirs(repositoriesRoot)) {
    for (const ref of await listRefs(gitDir, prefix)) {
      await deleteRef(gitDir, ref);
    }
  }
}
