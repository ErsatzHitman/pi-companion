/**
 * The daemon's workspace checkpoint store.
 *
 * Snapshots live under the daemon's private home (`$PASEO_HOME/checkpoints`),
 * never inside the user's workspace, so a workspace gains no `.git`-adjacent
 * state and its HEAD, index and refs are never touched. The semantics this class
 * implements are recorded in `plan.md` §4.2 ("Workspace checkpoint snapshots").
 *
 * Adapted from Supernova's `packages/agent-runtime/src/layers/session-runtime/
 * internal/checkpoint-store.ts` (symbols `CheckpointStore`, `captureProject`,
 * `restoreProject`, `WorkspaceCheckpointManifest`, `parseManifest`), MIT © 2026
 * Mattia Cerutti, read at commit
 * `5e6b861d152e41d4fd715abe1dba92421d45c753`; see `docs/T383-provenance.md`.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { join } from "node:path";

import { resolvePaseoHome } from "../../paseo-home.js";
import { shortDigest } from "./paths.js";
import {
  captureRepository,
  deleteCheckpointRef,
  deleteSessionRefs,
  discoverRepositories,
  repositoryMatchesTree,
  verifyCheckpointRef,
} from "./shadow-repository.js";
import type { RepositoryCheckpointState } from "./shadow-repository.js";
import { applyRestorePlan, buildRestorePlan, rollbackRestorePlan } from "./shadow-repository.js";
import type { RepositoryRestorePlan } from "./shadow-repository.js";

const MANIFEST_VERSION = 1;
const HASH_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REPOSITORY_ID_PATTERN = /^[0-9a-f]{64}$/;

export type CheckpointPhase = "before-turn" | "after-turn";

export interface CaptureCheckpointInput {
  readonly checkpointId: string;
  readonly phase?: CheckpointPhase;
  readonly sessionId: string;
  readonly workspaceRoot: string;
}

export interface RestoreCheckpointInput {
  readonly checkpointId: string;
  readonly force?: boolean;
  /**
   * The checkpoint representing the workspace's current state. When absent the
   * live workspace is captured as the baseline first, which requires `force`.
   */
  readonly fromCheckpointId?: string;
  readonly sessionId: string;
  readonly workspaceRoot: string;
}

export interface WorkspaceCheckpointStoreOptions {
  readonly storageRoot?: string;
  /**
   * Test seam: replaces the plan applier so a restore can be made to fail after
   * part of it has been applied, which is what the rollback path exists for.
   */
  readonly applyPlan?: (plan: RepositoryRestorePlan) => Promise<void>;
}

interface WorkspaceCheckpointManifest {
  readonly checkpointId: string;
  readonly repositories: readonly RepositoryCheckpointState[];
  readonly sessionId: string;
  readonly version: 1;
  readonly workspaceRoot: string;
}

interface RepositoryKeyed {
  readonly relativeRoot: string;
  readonly repositoryId: string;
}

/** The default storage root: a daemon-private directory outside any workspace. */
export function defaultCheckpointStorageRoot(): string {
  return resolve(join(resolvePaseoHome(), "checkpoints"));
}

async function canonicalDirectory(input: string): Promise<string> {
  const canonical = await realpath(resolve(input));
  if (!(await stat(canonical)).isDirectory()) {
    throw new Error("The workspace checkpoint root is not a directory.");
  }
  return canonical;
}

function repositoryKey(state: RepositoryKeyed): string {
  return `${state.repositoryId}\0${state.relativeRoot}`;
}

function parseManifest(
  value: unknown,
  expected: { checkpointId: string; sessionId: string; workspaceRoot: string },
): WorkspaceCheckpointManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("A checkpoint manifest is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== MANIFEST_VERSION ||
    record.checkpointId !== expected.checkpointId ||
    record.sessionId !== expected.sessionId ||
    record.workspaceRoot !== expected.workspaceRoot
  ) {
    throw new Error("A checkpoint manifest's ownership is invalid.");
  }
  if (!Array.isArray(record.repositories)) {
    throw new Error("A checkpoint manifest's repository list is invalid.");
  }
  const ids = new Set<string>();
  const roots = new Set<string>();
  const repositories = record.repositories.map((entry): RepositoryCheckpointState => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("A checkpoint repository state is invalid.");
    }
    const repository = entry as Record<string, unknown>;
    if (
      typeof repository.relativeRoot !== "string" ||
      typeof repository.repositoryId !== "string" ||
      typeof repository.treeId !== "string" ||
      typeof repository.refName !== "string" ||
      !REPOSITORY_ID_PATTERN.test(repository.repositoryId) ||
      !HASH_PATTERN.test(repository.treeId)
    ) {
      throw new Error("A checkpoint repository state is invalid.");
    }
    if (ids.has(repository.repositoryId) || roots.has(repository.relativeRoot)) {
      throw new Error("A checkpoint manifest contains duplicate repositories.");
    }
    ids.add(repository.repositoryId);
    roots.add(repository.relativeRoot);
    return {
      refName: repository.refName,
      relativeRoot: repository.relativeRoot,
      repositoryId: repository.repositoryId,
      treeId: repository.treeId,
    };
  });
  return {
    checkpointId: expected.checkpointId,
    repositories,
    sessionId: expected.sessionId,
    version: MANIFEST_VERSION,
    workspaceRoot: expected.workspaceRoot,
  };
}

/** Owns durable checkpoint manifests and coordinates app-private shadow repositories. */
export class WorkspaceCheckpointStore {
  private readonly applyPlan: (plan: RepositoryRestorePlan) => Promise<void>;
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly storageRoot: string;

  public constructor(options: WorkspaceCheckpointStoreOptions = {}) {
    this.storageRoot = resolve(options.storageRoot ?? defaultCheckpointStorageRoot());
    this.applyPlan = options.applyPlan ?? applyRestorePlan;
  }

  /** Returns whether this workspace can be snapshotted (a Git work tree plus a working git CLI). */
  public async isSupported(workspaceRoot: string): Promise<boolean> {
    try {
      const canonical = await canonicalDirectory(workspaceRoot);
      const repositories = await discoverRepositories(canonical, this.repositoriesRoot(canonical));
      return repositories.length > 0;
    } catch {
      return false;
    }
  }

  /** Captures one checkpoint of every repository under the workspace. */
  public async capture(input: CaptureCheckpointInput): Promise<void> {
    const canonical = await canonicalDirectory(input.workspaceRoot);
    await this.withLock(canonical, () => this.captureProject(canonical, input));
  }

  /** Restores the workspace to one checkpoint, refusing on a conflicting change unless `force`. */
  public async restore(input: RestoreCheckpointInput): Promise<void> {
    const canonical = await canonicalDirectory(input.workspaceRoot);
    await this.withLock(canonical, () => this.restoreProject(canonical, input));
  }

  /** Removes every checkpoint this session owns under the workspace. */
  public async deleteSession(input: { sessionId: string; workspaceRoot: string }): Promise<void> {
    try {
      const canonical = await canonicalDirectory(input.workspaceRoot);
      await this.withLock(canonical, async () => {
        const repositoriesRoot = this.repositoriesRoot(canonical);
        await deleteSessionRefs(repositoriesRoot, input.sessionId);
        await rm(this.manifestDirectory(canonical, input.sessionId), {
          force: true,
          recursive: true,
        });
      });
    } catch {
      // Deleting checkpoints is best-effort; a workspace that has gone away has
      // nothing left to clean.
      return;
    }
  }

  private projectStorage(canonical: string): string {
    return join(this.storageRoot, "workspaces", shortDigest(canonical));
  }

  private repositoriesRoot(canonical: string): string {
    return join(this.projectStorage(canonical), "repositories");
  }

  private manifestDirectory(canonical: string, sessionId: string): string {
    return join(this.projectStorage(canonical), "manifests", shortDigest(sessionId));
  }

  private manifestPath(canonical: string, sessionId: string, checkpointId: string): string {
    return join(this.manifestDirectory(canonical, sessionId), `${shortDigest(checkpointId)}.json`);
  }

  private withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(run);
    const tail = current.catch(() => undefined);
    this.locks.set(key, tail);
    void tail.finally(() => {
      if (this.locks.get(key) === tail) {
        this.locks.delete(key);
      }
    });
    return current;
  }

  private async writeManifest(path: string, manifest: WorkspaceCheckpointManifest): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    try {
      await rename(temporaryPath, path);
    } catch (cause) {
      await rm(temporaryPath, { force: true });
      throw cause;
    }
  }

  private async loadManifest(
    canonical: string,
    expected: { checkpointId: string; sessionId: string; workspaceRoot: string },
  ): Promise<WorkspaceCheckpointManifest> {
    const contents = await readFile(
      this.manifestPath(canonical, expected.sessionId, expected.checkpointId),
      "utf8",
    );
    return parseManifest(JSON.parse(contents), expected);
  }

  /** Captures every repository and publishes the manifest. Requires the workspace lock. */
  private async captureProject(canonical: string, input: CaptureCheckpointInput): Promise<void> {
    const repositories = await discoverRepositories(canonical, this.repositoriesRoot(canonical));
    if (repositories.length === 0) {
      throw new Error("Workspace checkpoints are not available for this workspace.");
    }

    const results = await Promise.allSettled(
      repositories.map((repository) =>
        captureRepository(repository, input.sessionId, input.checkpointId).then((state) => ({
          repository,
          state,
        })),
      ),
    );
    const captured = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );

    try {
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected) {
        throw rejected.reason;
      }
      await this.writeManifest(this.manifestPath(canonical, input.sessionId, input.checkpointId), {
        checkpointId: input.checkpointId,
        repositories: captured.map(({ state }) => state),
        sessionId: input.sessionId,
        version: MANIFEST_VERSION,
        workspaceRoot: canonical,
      });
    } catch (cause) {
      await Promise.all(
        captured.map(({ repository, state }) => deleteCheckpointRef(repository, state.refName)),
      );
      throw cause;
    }
  }

  /** Reconciles manifests and applies the workspace restore. Requires the workspace lock. */
  private async restoreProject(canonical: string, input: RestoreCheckpointInput): Promise<void> {
    const fromCheckpointId = input.fromCheckpointId ?? randomUUID();
    if (input.fromCheckpointId === undefined) {
      if (!input.force) {
        throw new Error("Restoring without a current checkpoint requires force.");
      }
      // Keep a durable safety snapshot and reuse the normal diff, preflight and
      // rollback pipeline.
      await this.captureProject(canonical, {
        checkpointId: fromCheckpointId,
        sessionId: input.sessionId,
        workspaceRoot: input.workspaceRoot,
      });
    }

    const [currentManifest, targetManifest, repositories] = await Promise.all([
      this.loadManifest(canonical, {
        checkpointId: fromCheckpointId,
        sessionId: input.sessionId,
        workspaceRoot: canonical,
      }),
      this.loadManifest(canonical, {
        checkpointId: input.checkpointId,
        sessionId: input.sessionId,
        workspaceRoot: canonical,
      }),
      discoverRepositories(canonical, this.repositoriesRoot(canonical)),
    ]);

    const discoveredByKey = new Map(
      repositories.map((repository) => [repositoryKey(repository), repository]),
    );
    const currentByKey = new Map(
      currentManifest.repositories.map((state) => [repositoryKey(state), state]),
    );
    const targetByKey = new Map(
      targetManifest.repositories.map((state) => [repositoryKey(state), state]),
    );

    for (const state of [...currentManifest.repositories, ...targetManifest.repositories]) {
      const repository = discoveredByKey.get(repositoryKey(state));
      if (repository) {
        await verifyCheckpointRef(repository, state);
      } else if (targetByKey.has(repositoryKey(state))) {
        throw new Error("A repository required by the checkpoint is missing or was replaced.");
      }
    }

    const plans: RepositoryRestorePlan[] = [];
    for (const [key, target] of targetByKey) {
      const repository = discoveredByKey.get(key);
      if (!repository) {
        throw new Error("A repository required by the checkpoint is missing or was replaced.");
      }
      const current = currentByKey.get(key);
      if (!current) {
        if (!(await repositoryMatchesTree(repository, target.treeId))) {
          throw new Error("A target-only repository does not match its checkpoint.");
        }
        continue;
      }
      plans.push(await buildRestorePlan(repository, current, target, input.force === true));
    }

    const touched: RepositoryRestorePlan[] = [];
    try {
      for (const plan of plans) {
        touched.push(plan);
        await this.applyPlan(plan);
      }
    } catch (cause) {
      for (const plan of touched.toReversed()) {
        await rollbackRestorePlan(plan).catch(() => undefined);
      }
      throw cause;
    }
  }
}

/** A store rooted at the daemon's private checkpoint storage. */
export function createWorkspaceCheckpointStore(
  options: WorkspaceCheckpointStoreOptions = {},
): WorkspaceCheckpointStore {
  return new WorkspaceCheckpointStore(options);
}
