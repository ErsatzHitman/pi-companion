import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import parcelWatcher from "@parcel/watcher";
import type pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import type { CheckoutSnapshotFacts, CheckoutStatusGit } from "../utils/checkout-git.js";
import { CheckoutDiffManager } from "./checkout-diff-manager.js";
import {
  subscribeToWorkspaceFileChanges,
  WorkspaceGitServiceImpl,
} from "./workspace-git-service.js";

function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    warn: vi.fn(),
  };
  return logger as unknown as pino.Logger;
}

function createFacts(cwd: string): CheckoutSnapshotFacts {
  return {
    isGit: true,
    worktreeRoot: cwd,
    currentBranch: "main",
    remoteUrl: null,
    absoluteGitDir: path.join(cwd, ".git"),
    gitCommonDir: path.join(cwd, ".git"),
    paseoWorktree: { isPaseoOwnedWorktree: false },
    storedBaseRef: null,
    resolvedBaseRef: "main",
    mainRepoRoot: null,
    comparisonBaseRef: null,
    branchRemoteName: null,
    branchMergeRef: null,
    pullRequestLookupTarget: { headRef: "main" },
  };
}

function createStatus(cwd: string): CheckoutStatusGit {
  return {
    isGit: true,
    repoRoot: cwd,
    mainRepoRoot: null,
    currentBranch: "main",
    isDirty: false,
    baseRef: "main",
    aheadBehind: { ahead: 0, behind: 0 },
    aheadOfOrigin: null,
    behindOfOrigin: null,
    hasRemote: false,
    remoteUrl: null,
    isPaseoOwnedWorktree: false,
  };
}

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

test("native recursive observation updates tracked state and prunes ignored storms", async () => {
  const tempDir = realpathSync(mkdtempSync(path.join(tmpdir(), "paseo-git-observation-")));
  const repoDir = path.join(tempDir, "repo");
  const trackedPath = path.join(repoDir, "src", "tracked.txt");
  const ignoredDir = path.join(repoDir, "build");
  const remainingIgnoredDir = path.join(repoDir, "cache");
  const newlyTrackedPath = path.join(ignoredDir, "tracked.txt");
  mkdirSync(path.join(repoDir, ".git"), { recursive: true });
  mkdirSync(path.dirname(trackedPath), { recursive: true });
  mkdirSync(ignoredDir, { recursive: true });
  mkdirSync(remainingIgnoredDir, { recursive: true });
  writeFileSync(trackedPath, "base\n");
  writeFileSync(newlyTrackedPath, "base\n");

  let activeWatcherCount = 0;
  let watcherStartCount = 0;
  let onWorkingTreeWatcherStopped: (() => void) | null = null;
  const deliveredEvents: Array<{
    directory: string;
    events: parcelWatcher.Event[];
  }> = [];
  const subscribe: typeof parcelWatcher.subscribe = async (directory, callback, options) => {
    const subscription = await subscribeToWorkspaceFileChanges(
      directory,
      (error, events) => {
        deliveredEvents.push({ directory, events });
        callback(error, events);
      },
      options,
    );
    activeWatcherCount += 1;
    watcherStartCount += 1;
    return {
      unsubscribe: async () => {
        await subscription.unsubscribe();
        activeWatcherCount -= 1;
        if (directory === repoDir) {
          const onStopped = onWorkingTreeWatcherStopped;
          onWorkingTreeWatcherStopped = null;
          onStopped?.();
        }
      },
    };
  };
  const getCheckoutSnapshotFacts = vi.fn(async (cwd: string) => createFacts(cwd));
  const getCheckoutStatus = vi.fn(async (cwd: string) => createStatus(cwd));
  const getCheckoutShortstat = vi.fn(async () => ({ additions: 0, deletions: 0 }));
  let observedPath = trackedPath;
  let observedRelativePath = "src/tracked.txt";
  const getCheckoutWorktreeState = vi.fn(async () => {
    const additions = readFileSync(observedPath, "utf8").trim().split("\n").length;
    return { isDirty: true, diffStat: { additions, deletions: 0 } };
  });
  const getCheckoutDiff = vi.fn(async () => {
    const additions = readFileSync(observedPath, "utf8").trim().split("\n").length;
    return {
      diff: "",
      structured: [
        { path: observedRelativePath, additions, deletions: 0, status: "modified" as const },
      ],
    };
  });
  let buildIgnored = true;
  const runGitCommand = vi.fn(async (args: string[]) => {
    if (args[0] === "rev-parse") {
      return {
        stdout: `${repoDir}\n`,
        stderr: "",
        truncated: false,
        exitCode: 0,
        signal: null,
      };
    }
    if (args[0] === "ls-files") {
      totalIgnoreReloads += 1;
      return {
        stdout: `${buildIgnored ? "build/\n" : ""}cache/\n`,
        stderr: "",
        truncated: false,
        exitCode: 0,
        signal: null,
      };
    }
    throw new Error(`Unexpected Git command: ${args.join(" ")}`);
  });
  /**
   * T309. These two exist because `expect(runGitCommand).not.toHaveBeenCalled()`
   * was the wrong assertion for the two ignored-storm windows below, and turned
   * `server-tests (windows-latest)` red at `285124d` — a commit that touched no
   * `packages/server` file at all.
   *
   * The mechanism, reproduced rather than reasoned about. This test injects
   * `getWorkspaceGitSelfHealPhaseMs`, which schedules ONE
   * `runSelfHealTick` (`startWorkspaceSubscriptionTimers` in
   * `../workspace-git-service.ts`); the interval that re-arms it is
   * `WORKSPACE_GIT_SELF_HEAL_INTERVAL_MS` = 60s, so exactly one tick can occur
   * inside this file's 15s budget. That tick calls
   * `refreshWorkingTreeIgnoredDirectories`, whose `loadIgnoredDirs` runs one
   * `git ls-files` through this very mock. Each storm window below then writes
   * 100 files into an ignored directory, waits a hard 750ms, and asserts nothing
   * happened. A tick landing inside one of those windows fails with exactly
   * "been called 1 times".
   *
   * Where the windows sit is decided by native-watcher latency, which the test
   * does not control. Measured by instrumenting this file: the first window
   * opens at +1121ms and the second at +9141ms, so the injected 7s tick falls
   * between them and every local run passes. On the CI Windows runner the
   * earlier `vi.waitFor` phases are slow enough to shift the first window onto
   * the tick. Setting the phase to 1_300 — inside the measured first window —
   * reproduces the CI failure locally and exactly.
   *
   * The tick cannot simply be pushed out of the way: the watcher-handoff phase
   * further down flips `buildIgnored` and waits for the working-tree watcher to
   * be torn down and restarted, and after initial setup `runSelfHealTick` is the
   * ONLY caller that re-reads the ignore list and performs that handoff
   * (`promoteWorkingTreeWatchTarget` is the other, and runs once). Measured:
   * a 10-minute phase makes these windows pass and then fails the file at
   * `expect(editedDuringWatcherHandoff).toBe(true)`. The tick is load-bearing
   * for one phase and fatal to another.
   *
   * So the windows assert their actual intent instead. "An ignored-file storm
   * triggers no work" is carried by the five `getCheckout*` mocks, which stay
   * ABSOLUTE — a storm response reaches them through `refreshWorkspaceTarget`
   * and `notifyWorkingTreeConsumers`. What is relaxed is only this mock, and
   * only for `ls-files`: nothing on the storm path can reach `loadIgnoredDirs`,
   * so tolerating one ignore reload gives up no coverage, while the `<= 1`
   * bound still fails if a storm ever starts reloading the ignore list per
   * event.
   */
  const gitCommandsOtherThanIgnoreReload = () =>
    runGitCommand.mock.calls.filter(([args]) => args[0] !== "ls-files");
  const selfHealIgnoreReloads = () =>
    runGitCommand.mock.calls.filter(([args]) => args[0] === "ls-files").length;
  // Cumulative, because every phase below calls `runGitCommand.mockClear()` and
  // the two guards further down need to know whether the ONE self-heal tick has
  // been spent yet — a question `mock.calls` cannot answer after a clear.
  let totalIgnoreReloads = 0;

  const service = new WorkspaceGitServiceImpl({
    logger: createLogger(),
    paseoHome: path.join(tempDir, "paseo-home"),
    deps: {
      subscribe,
      getCheckoutSnapshotFacts,
      getCheckoutStatus,
      getCheckoutShortstat,
      getCheckoutWorktreeState,
      getCheckoutDiff,
      runGitCommand,
      // T365. Was `12_000` (T309), and `7_000` before that. The single
      // self-heal tick this schedules is load-bearing for the
      // watcher-handoff phase below — after initial setup,
      // `runSelfHealTick` is the ONLY caller that re-reads the ignore list —
      // so it MUST land after `buildIgnored = false`. Twice now it has not:
      // the flip is measured at about +1.9s on this machine and about +7.7s
      // on the CI Windows runner that broke the 7s value, and CI run
      // 34548895358 broke the 12s one too, on a commit touching no
      // `packages/server` file at all (its whole `server-tests
      // (windows-latest)` job took 465s). The tick was spent before the
      // flip, so the handoff never happened and the phase below timed out.
      //
      // This is NOT the contention shape `CLAUDE.md`'s T240 section is about
      // and the remedy there — move the file into `test:unit:serial` — does
      // not apply: this file has been in that lane since 2026-09-08, so
      // nothing is racing it. What is raised here is a calibrated PHASE, a
      // number chosen to sit after an event whose time the test does not
      // control, not a timeout masking a real defect.
      //
      // 20s is the widest margin the surrounding budgets can carry, and it
      // costs local runtime: on this machine the flip lands at ~1.9s, so the
      // handoff below now waits ~18s for a tick it used to wait ~10s for.
      // That is deliberate — a fast test that is wrong one run in ten is
      // worth less than a slow one that is right. The check immediately
      // after the flip is the other half of the fix: when this value is
      // wrong again it now fails in one line, at the flip, naming the
      // remedy, instead of burning the handoff phase's full budget on an
      // assertion about watcher counts.
      getWorkspaceGitSelfHealPhaseMs: () => 20_000,
    } as never,
  });
  const diffManager = new CheckoutDiffManager({
    logger: createLogger(),
    paseoHome: path.join(tempDir, "paseo-home"),
    workspaceGitService: service,
  });
  const summaryListener = vi.fn();
  const diffListener = vi.fn();
  const summarySubscription = service.registerWorkspace({ cwd: repoDir }, summaryListener);
  const diffSubscription = await diffManager.subscribe(
    { cwd: repoDir, compare: { mode: "uncommitted" } },
    diffListener,
  );

  cleanup.push(async () => {
    diffSubscription.unsubscribe();
    summarySubscription.unsubscribe();
    diffManager.dispose();
    service.dispose();
    await vi.waitFor(() => expect(activeWatcherCount).toBe(0), { timeout: 5_000 });
    rmSync(tempDir, { recursive: true, force: true });
  });

  await vi.waitFor(
    () => {
      expect(activeWatcherCount).toBe(2);
      expect(service.peekSnapshot(repoDir)).not.toBeNull();
      expect(service.getMetrics()).toMatchObject({
        workspaceObservationSetupInFlightCount: 0,
        workspaceRefreshInFlightCount: 0,
        workspaceRefreshQueuedCount: 0,
      });
    },
    { timeout: 5_000 },
  );

  writeFileSync(trackedPath, "base\n");
  await vi.waitFor(
    () => {
      const events = deliveredEvents.flatMap((batch) => batch.events);
      expect(events.map((event) => event.path)).toContain(trackedPath);
      expect(getCheckoutWorktreeState).toHaveBeenCalled();
      expect(service.getMetrics()).toMatchObject({
        workspaceRefreshInFlightCount: 0,
        workspaceRefreshQueuedCount: 0,
      });
    },
    { timeout: 5_000 },
  );

  getCheckoutSnapshotFacts.mockClear();
  getCheckoutStatus.mockClear();
  getCheckoutShortstat.mockClear();
  getCheckoutWorktreeState.mockClear();
  getCheckoutDiff.mockClear();
  runGitCommand.mockClear();
  deliveredEvents.length = 0;

  expect(runGitCommand).not.toHaveBeenCalled();
  expect(getCheckoutWorktreeState).not.toHaveBeenCalled();
  expect(getCheckoutDiff, JSON.stringify(deliveredEvents)).not.toHaveBeenCalled();
  expect(service.getMetrics().workspaceRefreshQueuedCount).toBe(0);

  for (let index = 0; index < 100; index += 1) {
    writeFileSync(path.join(ignoredDir, `artifact-${index}.txt`), `${index}\n`);
  }
  await new Promise((resolve) => setTimeout(resolve, 750));

  // T309: NOT `expect(runGitCommand).not.toHaveBeenCalled()`. The periodic
  // self-heal audit runs one `git ls-files` of its own on a schedule this
  // window has no control over, so an absolute assertion here fails whenever
  // that tick lands inside the 750ms — which is decided by native-watcher
  // latency, not by anything under test. See `selfHealIgnoreReloads` for the
  // full reasoning and the reproduction.
  expect(gitCommandsOtherThanIgnoreReload()).toEqual([]);
  expect(selfHealIgnoreReloads()).toBeLessThanOrEqual(1);
  expect(getCheckoutSnapshotFacts).not.toHaveBeenCalled();
  expect(getCheckoutStatus).not.toHaveBeenCalled();
  expect(getCheckoutShortstat).not.toHaveBeenCalled();
  expect(getCheckoutWorktreeState).not.toHaveBeenCalled();
  expect(getCheckoutDiff).not.toHaveBeenCalled();
  expect(service.getMetrics().workspaceRefreshQueuedCount).toBe(0);

  writeFileSync(trackedPath, "first\nsecond\n");
  await vi.waitFor(
    () => {
      expect(summaryListener).toHaveBeenLastCalledWith(
        expect.objectContaining({
          git: expect.objectContaining({
            isDirty: true,
            diffStat: { additions: 2, deletions: 0 },
          }),
        }),
      );
      expect(diffListener).toHaveBeenLastCalledWith({
        cwd: repoDir,
        files: [
          {
            path: "src/tracked.txt",
            additions: 2,
            deletions: 0,
            status: "modified",
          },
        ],
        error: null,
      });
      expect(service.getMetrics().workspaceRefreshQueuedCount).toBe(0);
    },
    { timeout: 5_000 },
  );

  writeFileSync(trackedPath, "first\nsecond\nthird\n");
  await vi.waitFor(
    () => {
      expect(summaryListener).toHaveBeenLastCalledWith(
        expect.objectContaining({
          git: expect.objectContaining({
            diffStat: { additions: 3, deletions: 0 },
          }),
        }),
      );
      expect(diffListener).toHaveBeenLastCalledWith(
        expect.objectContaining({
          files: [expect.objectContaining({ additions: 3 })],
        }),
      );
      expect(service.getMetrics()).toMatchObject({
        workspaceRefreshInFlightCount: 0,
        workspaceRefreshQueuedCount: 0,
      });
    },
    { timeout: 5_000 },
  );

  expect(getCheckoutSnapshotFacts).not.toHaveBeenCalled();
  expect(getCheckoutStatus).not.toHaveBeenCalled();

  // T309. The handoff below needs an ignore reload to happen AFTER this flip: a
  // reload that runs while `build/` is still ignored finds the set unchanged
  // (`haveSamePaths`) and returns without reconfiguring the watcher. Counting
  // from here rather than from zero because initial setup already performs one
  // reload of its own — `promoteWorkingTreeWatchTarget` calls
  // `refreshWorkingTreeIgnoredDirectories` once, before any tick.
  const reloadsBeforeFlip = totalIgnoreReloads;
  // T365: the handoff below needs the ONE self-heal tick to still be
  // pending right now. When it is not, every assertion in that phase is
  // unreachable and the file spends its whole `vi.waitFor` budget before
  // reporting a watcher count — which is how CI run 34548895358 read, and
  // it says nothing about the real cause. Fail here instead, immediately,
  // naming the number to change.
  expect(
    totalIgnoreReloads,
    "the self-heal tick was already spent before the ignore list changed, so the " +
      "watcher handoff below can never happen. The earlier phases took longer than " +
      "the injected getWorkspaceGitSelfHealPhaseMs; raise it (and the handoff " +
      "vi.waitFor budget and this test's own timeout with it).",
    // At most the ONE reload initial setup performs of its own
    // (`promoteWorkingTreeWatchTarget`, see the note just above); a second
    // means the tick has already run.
  ).toBeLessThanOrEqual(1);
  buildIgnored = false;
  observedPath = newlyTrackedPath;
  observedRelativePath = "build/tracked.txt";
  let editedDuringWatcherHandoff = false;
  onWorkingTreeWatcherStopped = () => {
    editedDuringWatcherHandoff = true;
    writeFileSync(newlyTrackedPath, "first\nsecond\n");
  };
  writeFileSync(path.join(repoDir, ".git", "index"), "force-added\n");
  await vi.waitFor(
    () => {
      expect(
        editedDuringWatcherHandoff,
        "the working-tree watcher was never reconfigured after the ignore list changed. " +
          "After initial setup only runSelfHealTick re-reads it, so its single tick " +
          "landed before this flip: raise getWorkspaceGitSelfHealPhaseMs above.",
      ).toBe(true);
      expect(watcherStartCount).toBe(3);
      expect(activeWatcherCount).toBe(2);
      expect(summaryListener).toHaveBeenLastCalledWith(
        expect.objectContaining({
          git: expect.objectContaining({
            isDirty: true,
            diffStat: { additions: 2, deletions: 0 },
          }),
        }),
      );
      expect(diffListener).toHaveBeenLastCalledWith({
        cwd: repoDir,
        files: [
          {
            path: "build/tracked.txt",
            additions: 2,
            deletions: 0,
            status: "modified",
          },
        ],
        error: null,
      });
      expect(service.getMetrics()).toMatchObject({
        workspaceRefreshInFlightCount: 0,
        workspaceRefreshQueuedCount: 0,
      });
    },
    // T365: raised from 15s alongside the 20s phase above — the window
    // this waits in opens at the flip and must still contain the tick.
    { timeout: 25_000 },
  );

  // T309: the handoff above is only meaningful if a reload actually performed
  // it, and specifically one AFTER the flip. Without this, a future change
  // could leave that phase passing vacuously.
  expect(totalIgnoreReloads).toBeGreaterThan(reloadsBeforeFlip);

  getCheckoutSnapshotFacts.mockClear();
  getCheckoutStatus.mockClear();
  getCheckoutShortstat.mockClear();
  getCheckoutWorktreeState.mockClear();
  getCheckoutDiff.mockClear();
  runGitCommand.mockClear();
  summaryListener.mockClear();
  diffListener.mockClear();

  writeFileSync(newlyTrackedPath, "first\nsecond\nthird\nfourth\n");
  await vi.waitFor(
    () => {
      expect(summaryListener).toHaveBeenLastCalledWith(
        expect.objectContaining({
          git: expect.objectContaining({
            isDirty: true,
            diffStat: { additions: 4, deletions: 0 },
          }),
        }),
      );
      expect(diffListener).toHaveBeenLastCalledWith({
        cwd: repoDir,
        files: [
          {
            path: "build/tracked.txt",
            additions: 4,
            deletions: 0,
            status: "modified",
          },
        ],
        error: null,
      });
      expect(service.getMetrics()).toMatchObject({
        workspaceRefreshInFlightCount: 0,
        workspaceRefreshQueuedCount: 0,
      });
    },
    { timeout: 5_000 },
  );

  getCheckoutSnapshotFacts.mockClear();
  getCheckoutStatus.mockClear();
  getCheckoutShortstat.mockClear();
  getCheckoutWorktreeState.mockClear();
  getCheckoutDiff.mockClear();
  runGitCommand.mockClear();

  for (let index = 0; index < 100; index += 1) {
    writeFileSync(path.join(remainingIgnoredDir, `artifact-${index}.txt`), `${index}\n`);
  }
  await new Promise((resolve) => setTimeout(resolve, 750));

  // T309: NOT `expect(runGitCommand).not.toHaveBeenCalled()`. The periodic
  // self-heal audit runs one `git ls-files` of its own on a schedule this
  // window has no control over, so an absolute assertion here fails whenever
  // that tick lands inside the 750ms — which is decided by native-watcher
  // latency, not by anything under test. See `selfHealIgnoreReloads` for the
  // full reasoning and the reproduction.
  expect(gitCommandsOtherThanIgnoreReload()).toEqual([]);
  expect(selfHealIgnoreReloads()).toBeLessThanOrEqual(1);
  expect(getCheckoutSnapshotFacts).not.toHaveBeenCalled();
  expect(getCheckoutStatus).not.toHaveBeenCalled();
  expect(getCheckoutShortstat).not.toHaveBeenCalled();
  expect(getCheckoutWorktreeState).not.toHaveBeenCalled();
  expect(getCheckoutDiff).not.toHaveBeenCalled();
  expect(service.getMetrics().workspaceRefreshQueuedCount).toBe(0);
  // T365: raised from 30s. A 20s phase plus a 25s handoff window does not
  // fit in 30, and this test's cost is dominated by waiting for one timer
  // it deliberately schedules late, not by work.
}, 75_000);
