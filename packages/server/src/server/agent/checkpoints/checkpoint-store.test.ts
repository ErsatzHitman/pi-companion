import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { CheckpointConflictError, WorkspaceCheckpointStore, applyRestorePlan } from "./index.js";
import {
  MAX_UNTRACKED_BINARY_BYTES,
  MAX_UNTRACKED_FILE_BYTES,
  shouldCaptureFile,
} from "./exclusions.js";

const scratchDirectories: string[] = [];

function scratchDirectory(prefix: string): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratchDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function initRepository(root: string): void {
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Checkpoint Test"]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["config", "commit.gpgsign", "false"]);
}

function commitAll(root: string): void {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "snapshot"]);
}

interface Workspace {
  readonly root: string;
  readonly storageRoot: string;
  readonly store: WorkspaceCheckpointStore;
  readonly sessionId: string;
}

function createWorkspace(): Workspace {
  const root = scratchDirectory("picompanion-checkpoint-workspace-");
  initRepository(root);
  writeFileSync(join(root, "a.txt"), "A\n");
  writeFileSync(join(root, "to-delete.txt"), "gone soon\n");
  commitAll(root);

  const storageRoot = scratchDirectory("picompanion-checkpoint-store-");
  return {
    root,
    storageRoot,
    store: new WorkspaceCheckpointStore({ storageRoot }),
    sessionId: "session-1",
  };
}

function capture(workspace: Workspace, checkpointId: string, phase: "before-turn" | "after-turn") {
  return workspace.store.capture({
    checkpointId,
    phase,
    sessionId: workspace.sessionId,
    workspaceRoot: workspace.root,
  });
}

describe("workspace checkpoints", () => {
  test("a turn boundary leaves a restorable snapshot outside the workspace and never moves HEAD", async () => {
    const workspace = createWorkspace();
    const headBefore = git(workspace.root, ["rev-parse", "HEAD"]).trim();
    writeFileSync(join(workspace.root, "a.txt"), "changed during the turn\n");

    await capture(workspace, "before-turn-1", "before-turn");

    expect(git(workspace.root, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    expect(git(workspace.root, ["for-each-ref", "--format=%(refname)"])).not.toContain(
      "checkpoints",
    );
    // The manifest and shadow objects live under the daemon's private storage,
    // not inside the workspace.
    expect(existsSync(join(workspace.storageRoot, "workspaces"))).toBe(true);
    expect(join(workspace.storageRoot, "workspaces").startsWith(workspace.root)).toBe(false);
    expect(existsSync(join(workspace.root, ".git", "picompanion-checkpoints"))).toBe(false);
  });

  test("restoring reproduces the target snapshot byte-for-byte", async () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace.root, "sub"), { recursive: true });
    writeFileSync(join(workspace.root, "sub", "nested.txt"), "nested A\n");
    await capture(workspace, "cp-a", "before-turn");

    writeFileSync(join(workspace.root, "a.txt"), "B\n");
    writeFileSync(join(workspace.root, "sub", "nested.txt"), "nested B\n");
    writeFileSync(join(workspace.root, "added.txt"), "added later\n");
    rmSync(join(workspace.root, "to-delete.txt"));
    await capture(workspace, "cp-b", "after-turn");

    await workspace.store.restore({
      checkpointId: "cp-a",
      fromCheckpointId: "cp-b",
      sessionId: workspace.sessionId,
      workspaceRoot: workspace.root,
    });

    expect(readFileSync(join(workspace.root, "a.txt"), "utf8")).toBe("A\n");
    expect(readFileSync(join(workspace.root, "sub", "nested.txt"), "utf8")).toBe("nested A\n");
    expect(readFileSync(join(workspace.root, "to-delete.txt"), "utf8")).toBe("gone soon\n");
    expect(existsSync(join(workspace.root, "added.txt"))).toBe(false);
  });

  test("refuses a restore after an outside change unless force is set", async () => {
    const workspace = createWorkspace();
    await capture(workspace, "cp-a", "before-turn");
    writeFileSync(join(workspace.root, "a.txt"), "B\n");
    await capture(workspace, "cp-b", "after-turn");

    // The user edits the file outside the checkpoint system.
    writeFileSync(join(workspace.root, "a.txt"), "hand edit\n");

    await expect(
      workspace.store.restore({
        checkpointId: "cp-a",
        fromCheckpointId: "cp-b",
        sessionId: workspace.sessionId,
        workspaceRoot: workspace.root,
      }),
    ).rejects.toBeInstanceOf(CheckpointConflictError);
    // Nothing was applied.
    expect(readFileSync(join(workspace.root, "a.txt"), "utf8")).toBe("hand edit\n");

    await workspace.store.restore({
      checkpointId: "cp-a",
      force: true,
      fromCheckpointId: "cp-b",
      sessionId: workspace.sessionId,
      workspaceRoot: workspace.root,
    });
    expect(readFileSync(join(workspace.root, "a.txt"), "utf8")).toBe("A\n");
  });

  test("rolls the worktree back when a restore fails midway", async () => {
    const root = scratchDirectory("picompanion-checkpoint-multi-");
    initRepository(root);
    writeFileSync(join(root, "root.txt"), "A\n");
    commitAll(root);

    const childRoot = join(root, "child");
    mkdirSync(childRoot, { recursive: true });
    initRepository(childRoot);
    writeFileSync(join(childRoot, "child.txt"), "A\n");
    commitAll(childRoot);

    const storageRoot = scratchDirectory("picompanion-checkpoint-multi-store-");
    const sessionId = "session-multi";
    const store = new WorkspaceCheckpointStore({ storageRoot });
    const captureId = (checkpointId: string) =>
      store.capture({ checkpointId, sessionId, workspaceRoot: root });

    await captureId("cp-a");
    writeFileSync(join(root, "root.txt"), "B\n");
    writeFileSync(join(childRoot, "child.txt"), "B\n");
    await captureId("cp-b");

    const failing = new WorkspaceCheckpointStore({
      applyPlan: async (plan) => {
        if (plan.repository.relativeRoot !== ".") {
          throw new Error("injected mid-restore failure");
        }
        await applyRestorePlan(plan);
      },
      storageRoot,
    });

    await expect(
      failing.restore({
        checkpointId: "cp-a",
        fromCheckpointId: "cp-b",
        sessionId,
        workspaceRoot: root,
      }),
    ).rejects.toThrow("injected mid-restore failure");

    // The repository that was already restored is back at its pre-restore state.
    expect(readFileSync(join(root, "root.txt"), "utf8")).toBe("B\n");
    expect(readFileSync(join(childRoot, "child.txt"), "utf8")).toBe("B\n");
  });

  test("excludes node_modules, .git and over-cap untracked files from a capture", async () => {
    expect(
      shouldCaptureFile({
        binary: false,
        path: "node_modules/dep/index.js",
        size: 10,
        untracked: true,
      }),
    ).toBe(false);
    expect(
      shouldCaptureFile({ binary: false, path: "src/.git/config", size: 10, untracked: true }),
    ).toBe(false);
    expect(
      shouldCaptureFile({
        binary: false,
        path: "big.log",
        size: MAX_UNTRACKED_FILE_BYTES + 1,
        untracked: true,
      }),
    ).toBe(false);
    expect(
      shouldCaptureFile({
        binary: true,
        path: "large.iso",
        size: MAX_UNTRACKED_BINARY_BYTES + 1,
        untracked: true,
      }),
    ).toBe(false);
    expect(
      shouldCaptureFile({ binary: true, path: "small.png", size: 1024, untracked: true }),
    ).toBe(true);
    expect(
      shouldCaptureFile({
        binary: true,
        path: "tracked.iso",
        size: 64 * 1024 * 1024,
        untracked: false,
      }),
    ).toBe(true);
    expect(
      shouldCaptureFile({ binary: false, path: "child/x.txt", size: 10, untracked: true }, [
        "child",
      ]),
    ).toBe(false);

    const workspace = createWorkspace();
    mkdirSync(join(workspace.root, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(workspace.root, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
    writeFileSync(join(workspace.root, "huge.bin"), Buffer.alloc(MAX_UNTRACKED_FILE_BYTES + 1, 1));
    await capture(workspace, "cp-excluded", "before-turn");

    rmSync(join(workspace.root, "node_modules"), { force: true, recursive: true });
    rmSync(join(workspace.root, "huge.bin"), { force: true });
    writeFileSync(join(workspace.root, "a.txt"), "moved on\n");
    await capture(workspace, "cp-excluded-next", "after-turn");

    await workspace.store.restore({
      checkpointId: "cp-excluded",
      fromCheckpointId: "cp-excluded-next",
      sessionId: workspace.sessionId,
      workspaceRoot: workspace.root,
    });

    // Excluded files are in no snapshot, so a restore never resurrects them.
    expect(existsSync(join(workspace.root, "node_modules"))).toBe(false);
    expect(existsSync(join(workspace.root, "huge.bin"))).toBe(false);
    expect(readFileSync(join(workspace.root, "a.txt"), "utf8")).toBe("A\n");
  });
});
