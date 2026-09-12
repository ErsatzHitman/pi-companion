import { describe, expect, it } from "vitest";

import type { FileBrowserClient } from "./file-browser-client";
import { createFileOpsController, type FileOpsState } from "./file-ops-model";

/** Lets the controller's `action().then(...)` settle before the next assertion. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface OpsCalls {
  mkdir: Array<{ cwd: string; path: string }>;
  createFile: Array<{ cwd: string; path: string; content: string | undefined }>;
  renameEntry: Array<{ cwd: string; oldPath: string; newPath: string }>;
  deleteEntry: Array<{ cwd: string; path: string; recursive: boolean | undefined }>;
}

function emptyCalls(): OpsCalls {
  return { mkdir: [], createFile: [], renameEntry: [], deleteEntry: [] };
}

/**
 * A recording `FileBrowserClient` whose four mutation members succeed by
 * default. `overrides` replaces one member wholesale (used by the
 * failure tests); the other members keep recording normally.
 */
function createRecordingClient(overrides: Partial<FileBrowserClient> = {}) {
  const calls = emptyCalls();
  const client: FileBrowserClient = {
    listDirectory: () => Promise.reject(new Error("not used by file-ops-model tests")),
    mkdir: (cwd, path) => {
      calls.mkdir.push({ cwd, path });
      return Promise.resolve({ path });
    },
    createFile: (cwd, path, content) => {
      calls.createFile.push({ cwd, path, content });
      return Promise.resolve({ path });
    },
    renameEntry: (cwd, oldPath, newPath) => {
      calls.renameEntry.push({ cwd, oldPath, newPath });
      return Promise.resolve({ oldPath, newPath });
    },
    deleteEntry: (cwd, path, recursive) => {
      calls.deleteEntry.push({ cwd, path, recursive });
      return Promise.resolve({ path });
    },
    ...overrides,
  };
  return { client, calls };
}

function controllerFor(
  client: FileBrowserClient,
  onChanged?: () => void,
): ReturnType<typeof createFileOpsController> {
  return createFileOpsController({ client, workspaceRoot: "/ws", onChanged });
}

// ---------------------------------------------------------------------------
// Success paths
// ---------------------------------------------------------------------------

describe("createFileOpsController success paths", () => {
  it("runs mkdir against the workspace root and reports a plain-language success", async () => {
    const { client, calls } = createRecordingClient();
    let changed = 0;
    const controller = controllerFor(client, () => {
      changed += 1;
    });

    controller.mkdir("src/components");
    expect(controller.getState().status).toBe("running");
    expect(controller.getState().operation).toBe("mkdir");

    await flush();

    expect(calls.mkdir).toEqual([{ cwd: "/ws", path: "src/components" }]);
    const state = controller.getState();
    expect(state.status).toBe("success");
    expect(state.operation).toBe("mkdir");
    expect(state.message).toBe("Created folder src/components");
    expect(state.error).toBeNull();
    expect(changed).toBe(1);
  });

  it("runs createFile with its content, and without it when omitted", async () => {
    const { client, calls } = createRecordingClient();
    const controller = controllerFor(client);

    controller.createFile("src/notes.md", "hello");
    await flush();
    controller.createFile("src/empty.md");
    await flush();

    expect(calls.createFile).toEqual([
      { cwd: "/ws", path: "src/notes.md", content: "hello" },
      { cwd: "/ws", path: "src/empty.md", content: undefined },
    ]);
    expect(controller.getState().message).toBe("Created file src/empty.md");
  });

  it("runs renameEntry with both paths and reports the move", async () => {
    const { client, calls } = createRecordingClient();
    const controller = controllerFor(client);

    controller.rename("src/old.ts", "src/new.ts");
    await flush();

    expect(calls.renameEntry).toEqual([
      { cwd: "/ws", oldPath: "src/old.ts", newPath: "src/new.ts" },
    ]);
    expect(controller.getState().message).toBe("Renamed src/old.ts to src/new.ts");
  });

  it("runs the armed delete with recursive false by default and reports it", async () => {
    const { client, calls } = createRecordingClient();
    const controller = controllerFor(client);

    controller.armDelete("notes.md");
    controller.confirmDelete();
    await flush();

    expect(calls.deleteEntry).toEqual([{ cwd: "/ws", path: "notes.md", recursive: false }]);
    expect(controller.getState().status).toBe("success");
    expect(controller.getState().message).toBe("Deleted notes.md");
  });

  it("reloads through onChanged exactly once per success, and never on the arm step", async () => {
    const { client } = createRecordingClient();
    let changed = 0;
    const controller = controllerFor(client, () => {
      changed += 1;
    });

    controller.armDelete("notes.md");
    expect(changed).toBe(0);

    controller.confirmDelete();
    await flush();
    expect(changed).toBe(1);

    controller.mkdir("src");
    await flush();
    expect(changed).toBe(2);
  });

  it("reset clears a success result and any armed delete", async () => {
    const { client } = createRecordingClient();
    const controller = controllerFor(client);

    controller.mkdir("src");
    await flush();
    controller.armDelete("notes.md");
    controller.reset();

    expect(controller.getState()).toEqual({
      status: "idle",
      operation: null,
      message: null,
      error: null,
      pendingDelete: null,
    } satisfies FileOpsState);
  });
});

// ---------------------------------------------------------------------------
// Error explainers — every operation maps through explainFileOpsError
// ---------------------------------------------------------------------------

describe("createFileOpsController failures", () => {
  const cases: Array<{
    operation: "mkdir" | "createFile" | "rename" | "delete";
    raw: string;
    title: string;
  }> = [
    { operation: "mkdir", raw: "Destination already exists", title: "Something is already there" },
    {
      operation: "createFile",
      raw: "EACCES: permission denied",
      title: "Permission denied",
    },
    {
      operation: "rename",
      raw: "Requested path does not exist",
      title: "This no longer exists",
    },
    {
      operation: "delete",
      raw: "Directory is not empty",
      title: "This folder isn't empty",
    },
  ];

  for (const { operation, raw, title } of cases) {
    it(`${operation} failure surfaces explainFileOpsError's "${title}" and never reloads`, async () => {
      const rejection = () => Promise.reject(new Error(raw));
      const overrides: Partial<FileBrowserClient> =
        operation === "mkdir"
          ? { mkdir: rejection }
          : operation === "createFile"
            ? { createFile: rejection }
            : operation === "rename"
              ? { renameEntry: rejection }
              : { deleteEntry: rejection };
      const { client } = createRecordingClient(overrides);
      let changed = 0;
      const controller = controllerFor(client, () => {
        changed += 1;
      });

      if (operation === "mkdir") controller.mkdir("src");
      else if (operation === "createFile") controller.createFile("src/notes.md");
      else if (operation === "rename") controller.rename("a", "b");
      else {
        controller.armDelete("src");
        controller.confirmDelete();
      }
      await flush();

      const state = controller.getState();
      expect(state.status).toBe("error");
      expect(state.operation).toBe(operation === "createFile" ? "create-file" : operation);
      expect(state.error?.title).toBe(title);
      expect(state.message).toBeNull();
      expect(changed).toBe(0);
    });
  }

  it("keeps a failed delete's armed state cleared, so a stale confirm cannot fire later", async () => {
    const { client, calls } = createRecordingClient({
      deleteEntry: () => Promise.reject(new Error("Directory is not empty")),
    });
    const controller = controllerFor(client);

    controller.armDelete("src", true);
    controller.confirmDelete();
    await flush();

    expect(controller.getState().pendingDelete).toBeNull();
    expect(calls.deleteEntry).toHaveLength(0); // the override rejects without recording

    // Confirm again with nothing armed: no second request.
    controller.confirmDelete();
    await flush();
    expect(controller.getState().status).toBe("error");
  });

  it("ignores a second operation while one is already running", async () => {
    let release: (() => void) | undefined;
    const { client, calls } = createRecordingClient({
      mkdir: (cwd, path) => {
        calls.mkdir.push({ cwd, path });
        return new Promise((resolve) => {
          release = () => resolve({ path });
        });
      },
    });
    const controller = controllerFor(client);

    controller.mkdir("first");
    controller.createFile("second.md");
    await flush();

    expect(calls.createFile).toHaveLength(0);
    expect(controller.getState().operation).toBe("mkdir");

    release?.();
    await flush();
    expect(controller.getState().status).toBe("success");
  });
});

// ---------------------------------------------------------------------------
// Missing optional members — the FILE_OPS_NOT_CONNECTED sentinel
// ---------------------------------------------------------------------------

describe("createFileOpsController with a client that has no mutation members", () => {
  const client: FileBrowserClient = {
    listDirectory: () => Promise.reject(new Error("not used by file-ops-model tests")),
  };

  it("mkdaring without a mkdir member fails with the not-connected explanation and no timer/RPC", async () => {
    const controller = controllerFor(client);
    controller.mkdir("src");
    await flush();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.error?.title).toBe("Not connected");
    expect(state.error?.description).toMatch(/Connect to a daemon/i);
  });

  it("createFile/rename/delete all fail the same way", async () => {
    const controller = controllerFor(client);

    controller.createFile("a.md");
    await flush();
    expect(controller.getState().error?.title).toBe("Not connected");

    controller.rename("a", "b");
    await flush();
    expect(controller.getState().error?.title).toBe("Not connected");

    controller.armDelete("a");
    controller.confirmDelete();
    await flush();
    expect(controller.getState().error?.title).toBe("Not connected");
  });
});

// ---------------------------------------------------------------------------
// The two-step delete
// ---------------------------------------------------------------------------

describe("createFileOpsController delete confirmation", () => {
  it("arming a delete issues no daemon request and shows only the pending target", () => {
    const { client, calls } = createRecordingClient();
    const controller = controllerFor(client);

    controller.armDelete("src/notes.md", true);

    expect(calls.deleteEntry).toHaveLength(0);
    expect(controller.getState().pendingDelete).toEqual({
      path: "src/notes.md",
      recursive: true,
    });
    expect(controller.getState().status).toBe("idle");
  });

  it("confirmDelete with nothing armed is a no-op — no request, no state change", () => {
    const { client, calls } = createRecordingClient();
    const controller = controllerFor(client);

    controller.confirmDelete();

    expect(calls.deleteEntry).toHaveLength(0);
    expect(controller.getState().status).toBe("idle");
  });

  it("cancelDelete disarms without deleting", () => {
    const { client, calls } = createRecordingClient();
    const controller = controllerFor(client);

    controller.armDelete("src/notes.md");
    controller.cancelDelete();

    expect(calls.deleteEntry).toHaveLength(0);
    expect(controller.getState().pendingDelete).toBeNull();
  });

  it("passes recursive: true only through the armed confirm, never speculatively", async () => {
    const { client, calls } = createRecordingClient();
    const controller = controllerFor(client);

    // A non-recursive arm never escalates on its own.
    controller.armDelete("empty-folder");
    expect(calls.deleteEntry).toHaveLength(0);
    controller.confirmDelete();
    await flush();
    expect(calls.deleteEntry).toEqual([{ cwd: "/ws", path: "empty-folder", recursive: false }]);

    // Recursive is only ever sent after its own explicit arm+confirm.
    controller.armDelete("full-folder", true);
    expect(calls.deleteEntry).toHaveLength(1);
    controller.confirmDelete();
    await flush();
    expect(calls.deleteEntry[1]).toEqual({
      cwd: "/ws",
      path: "full-folder",
      recursive: true,
    });
  });

  it("arming a delete replaces any earlier result, and cancelDelete leaves an idle state", async () => {
    const { client } = createRecordingClient();
    const controller = controllerFor(client);

    controller.mkdir("src");
    await flush();
    expect(controller.getState().status).toBe("success");

    // Arming is a fresh action: it clears the previous op's feedback (the
    // confirm dialog is the feedback now). cancelDelete only removes the
    // pending target.
    controller.armDelete("src");
    expect(controller.getState().status).toBe("idle");
    expect(controller.getState().message).toBeNull();

    controller.cancelDelete();
    expect(controller.getState().status).toBe("idle");
    expect(controller.getState().pendingDelete).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// subscribe
// ---------------------------------------------------------------------------

describe("createFileOpsController subscribe", () => {
  it("delivers every state transition in order and stops after unsubscribe", async () => {
    const { client } = createRecordingClient();
    const controller = controllerFor(client);
    const seen: string[] = [];
    const unsubscribe = controller.subscribe((state) => seen.push(state.status));

    controller.mkdir("src");
    await flush();
    expect(seen).toEqual(["running", "success"]);

    unsubscribe();
    controller.mkdir("src2");
    await flush();
    expect(seen).toEqual(["running", "success"]);
  });
});
