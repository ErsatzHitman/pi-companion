import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createFlowRegistry } from "../harness/flow-registry";
import { listExitGateFlowNames } from "../harness/shard-plan";
import { PRODUCTION_DAEMON_PORT } from "../harness/production-daemon-port";
import {
  explainFileBrowserError,
  explainFileDownloadError,
  FILE_DOWNLOAD_NO_RELAY_ORIGIN,
} from "../../src/features/files/file-browser-client";
import {
  createFileDownloadController,
  type DownloadedFile,
  type DownloadFetch,
  type DownloadStreamReader,
} from "../../src/features/files/file-download-model";
import type { FileBrowserClient } from "../../src/features/files/file-browser-client";
import { FILE_DOWNLOAD_FLOW } from "./file-download-contract";
import { parseMaestroSteps } from "./maestro-yaml";

/**
 * T77 — proves every testId/deep-link/string
 * `../../maestro/file-download.yaml` names still exists in the real
 * source it targets, that the yaml's own literal steps agree with real
 * source (T72, `./maestro-yaml.ts`) rather than only agreeing with
 * `file-download-contract.ts`'s hand-typed restatement, and — because the
 * flow's own header comment discloses a real, unfixed gap
 * (`SessionFilesRoute`'s hardcoded `workspaceRoot=""` makes every listing
 * fail before a file can ever be selected) that keeps that flow's
 * device-observable steps from ever reaching `DownloadPanel` — proves the
 * download path itself (a real file selection, a real HTTP origin, a
 * real chunked byte stream, and T66's named relay refusal) directly
 * against the REAL, production `createFileDownloadController` /
 * `buildFileDownloadUrl`, the same "device can't show X, a contract test
 * can still prove Y with real code" split `files-and-terminal.contract.
 * test.ts`'s dispose-cascade integration test already established for
 * this directory.
 *
 * Two proof strategies, chosen per module, matching every sibling
 * `*.contract.test.ts` here:
 *
 * - `file-download-model.ts` and `file-browser-client.ts` are RN-free, so
 *   this file imports them directly and calls the real functions/classes.
 * - `files-screen.tsx` and the files route file reach `react-native`
 *   (directly, or indirectly through `FilesScreen`) and cannot be
 *   imported here, so those are proven with `readCode()`/
 *   `readComponentCode()` — comment-stripped source matched against a
 *   full JSX/statement expression, never a bare identifier, anchored to
 *   the one top-level function each assertion names.
 * - `workspace-files-session.ts` (the daemon's own empty-`cwd` rejection
 *   — the root cause this flow's header comment names) is read the same
 *   `readCode()` way, across the package boundary, by plain relative
 *   path: this repository is one checkout, so the file is there
 *   regardless of which workspace "owns" it, and pinning the daemon's own
 *   source is stronger than trusting this file's own retelling of it.
 *
 * Mutation-checked (see this task's report for the exact mutations,
 * their failures, and the byte-identical restores): the
 * `workspaceRoot=""` route assertion (changing the literal), the
 * `downloadController` selection-gate assertion (deleting `!selectedEntry`
 * from the guard), and the yaml-reads-real-copy check (editing
 * `explainFileBrowserError`'s "cwd is required" description).
 */

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** `readCode(relativePath)` sliced to a single top-level function's body — matches `files-and-terminal.contract.test.ts`'s `readComponentCode` exactly. */
function readComponentCode(relativePath: string, name: string): string {
  const code = readCode(relativePath);
  const startPattern = new RegExp(`^(?:export default )?(?:export )?function ${name}\\(`, "m");
  const startMatch = startPattern.exec(code);
  expect(startMatch, `${relativePath} should declare a top-level function ${name}`).not.toBeNull();
  const start = startMatch!.index;
  const nextPattern = /^(?:export default )?(?:export )?function \w+\(/gm;
  nextPattern.lastIndex = start + 1;
  const nextMatch = nextPattern.exec(code);
  const end = nextMatch ? nextMatch.index : code.length;
  return code.slice(start, end);
}

const FILES_SCREEN_TSX = "../../src/features/files/files-screen.tsx";
const FILES_ROUTE_TSX = "../../src/app/h/[serverId]/session/[agentId]/files/[...path].tsx";
const WORKSPACE_FILES_SESSION_TS =
  "../../../../packages/server/src/server/session/files/workspace-files-session.ts";

describe("file-download.yaml anchors exist in source", () => {
  describe("the route this flow's deep link opens", () => {
    it('resolves the session\'s real workspace root via useAgentCwd, "" only while unresolved — the route no longer hardcodes workspaceRoot="" (2026-09-12; this flow\'s e2e agent is unknown to the daemon, so the unresolved case is what this flow still reaches, and "No workspace selected" stays its honest state)', () => {
      const code = readCode(FILES_ROUTE_TSX);
      expect(code).toMatch(
        /<FilesScreen\s*\n\s*serverId=\{serverId\}\s*\n\s*agentId=\{agentId\}\s*\n\s*path=\{path \?\? \[\]\}\s*\n\s*workspaceRoot=\{cwd \?\? ""\}/,
      );
      expect(code).toMatch(/useAgentCwd\(resolveAgentSnapshotClient\(core\.connection\), agentId/);
    });

    it("passes a real client, downloadOrigin, connectionPath and fetchImpl through — a real HTTP origin is genuinely wired once paired", () => {
      const code = readCode(FILES_ROUTE_TSX);
      expect(code).toMatch(/client=\{core\.fileBrowserClient\}/);
      expect(code).toMatch(/downloadOrigin=\{downloadOrigin\}/);
      expect(code).toMatch(/connectionPath=\{connectionPath\}/);
      expect(code).toMatch(/fetchImpl=\{fetchImpl\}/);
      expect(code).toMatch(
        /const downloadOrigin = daemonAddress \? buildDaemonHttpOrigin\(daemonAddress\) : null;/,
      );
    });
  });

  describe("files-screen.tsx — why DownloadPanel is unreachable from this flow today", () => {
    it("downloadController requires selectedEntry (a pressed row) in addition to client/workspaceRoot/fetchImpl", () => {
      const code = readComponentCode(FILES_SCREEN_TSX, "FilesScreen");
      expect(code).toMatch(
        /const downloadController = useMemo\(\(\) => \{\s*if \(!client \|\| workspaceRoot === undefined \|\| !selectedEntry \|\| !fetchImpl\) return null;/,
      );
    });

    it("DownloadPanel only renders inside FileContentView, which only renders once selectedEntry is set", () => {
      const filesScreen = readComponentCode(FILES_SCREEN_TSX, "FilesScreen");
      expect(filesScreen).toMatch(
        /selectedEntry \? \(\s*<FileContentView[\s\S]{0,80}?entry=\{selectedEntry\}/,
      );
      const fileContentView = readComponentCode(FILES_SCREEN_TSX, "FileContentView");
      expect(fileContentView).toMatch(
        /\{downloadController \? \(\s*<DownloadPanel[\s\S]{0,40}?entry=\{entry\}/,
      );
    });

    it("the listing ErrorState carries testId={`${testId}-error`} and renders state.error's real title/description", () => {
      const code = readComponentCode(FILES_SCREEN_TSX, "FilesScreen");
      expect(code).toMatch(
        /state\.status === "error" \? \(\s*<ErrorState\s+title=\{state\.error\?\.title \?\? "Couldn't list this folder"\}\s+description=\{state\.error\?\.description \?\? ""\}\s+testId=\{`\$\{testId\}-error`\}/,
      );
    });
  });

  describe("workspace-files-session.ts (the daemon) — the root cause, pinned across the package boundary", () => {
    it('rejects an empty cwd with the literal "cwd is required" message, before ever touching a real path', () => {
      const code = readCode(WORKSPACE_FILES_SESSION_TS);
      expect(code).toMatch(
        /async handleFileExplorerRequest\(request: FileExplorerRequest, source\?: object\): Promise<void> \{\s*const \{ cwd: workspaceCwd, path: requestedPath = "\.", mode, requestId \} = request;\s*const cwd = workspaceCwd\.trim\(\);\s*if \(!cwd\) \{/,
      );
      expect(code).toMatch(/error: "cwd is required",/);
    });
  });

  describe('explainFileBrowserError("cwd is required") — the exact copy this flow asserts', () => {
    it('maps to title "No workspace selected", matching FILE_DOWNLOAD_FLOW\'s restatement', () => {
      const explanation = explainFileBrowserError("cwd is required");
      expect(explanation.title).toBe(FILE_DOWNLOAD_FLOW.noWorkspaceSelectedTitle);
      expect(explanation.description).toBe(FILE_DOWNLOAD_FLOW.noWorkspaceSelectedDescription);
    });
  });
});

// ---------------------------------------------------------------------------
// file-download.yaml itself, read from disk (T72) — never trust only the
// hand-typed FILE_DOWNLOAD_FLOW restatement above.
// ---------------------------------------------------------------------------
describe("file-download.yaml itself, read from disk", () => {
  const FILE_DOWNLOAD_YAML = "../../maestro/file-download.yaml";
  const yamlText = readSource(FILE_DOWNLOAD_YAML);
  const steps = parseMaestroSteps(yamlText);
  const testId = FILE_DOWNLOAD_FLOW.filesTestId(
    FILE_DOWNLOAD_FLOW.serverId,
    FILE_DOWNLOAD_FLOW.agentId,
  );

  it("opens exactly the deep link FILE_DOWNLOAD_FLOW.filesDeepLink builds", () => {
    const openLink = steps.find((step) => step.kind === "openLink");
    expect(openLink?.value).toBe(
      FILE_DOWNLOAD_FLOW.filesDeepLink(FILE_DOWNLOAD_FLOW.serverId, FILE_DOWNLOAD_FLOW.agentId),
    );
  });

  it("asserts the real files-screen root id visible, and the real not-connected/file ids absent", () => {
    const visibleIds = steps
      .filter((step) => step.kind === "assertVisible" && step.id !== undefined)
      .map((step) => step.id as string);
    const notVisibleIds = steps
      .filter((step) => step.kind === "assertNotVisible" && step.id !== undefined)
      .map((step) => step.id as string);

    expect(visibleIds).toContain(testId);
    expect(visibleIds).toContain(FILE_DOWNLOAD_FLOW.filesErrorTestId(testId));
    expect(notVisibleIds).toContain(FILE_DOWNLOAD_FLOW.filesNotConnectedTestId(testId));
    expect(notVisibleIds).toContain(FILE_DOWNLOAD_FLOW.filesFileTestId(testId));
  });

  it("asserts explainFileBrowserError(\"cwd is required\")'s real title and description as visible text — the flow's own honest reachable state, not a fabricated one", () => {
    const explanation = explainFileBrowserError("cwd is required");
    const visibleTexts = steps
      .filter((step) => step.kind === "assertVisible" && step.text !== undefined)
      .map((step) => step.text as string);
    expect(visibleTexts).toContain(explanation.title);
    expect(visibleTexts).toContain(explanation.description);
  });

  it("asserts the sessions-screen arrival after the connect, never the transient status text (T332)", () => {
    const visibleTexts = steps
      .filter((step) => step.kind === "assertVisible" && step.text !== undefined)
      .map((step) => step.text as string);
    const visibleIds = steps
      .filter((step) => step.kind === "assertVisible" && step.id !== undefined)
      .map((step) => step.id as string);
    // Run 34459631677: the connect navigates away before "Connected via
    // direct connection" can be sampled, so the flow asserts the arrival.
    expect(visibleTexts).not.toContain("Connected via direct connection");
    expect(visibleIds).toContain(FILE_DOWNLOAD_FLOW.sessionsScreenArrival);
  });

  it("never names the production daemon's port, in any form including comments", () => {
    expect(
      yamlText.includes(String(PRODUCTION_DAEMON_PORT)),
      `file-download.yaml must never name the production daemon port ${PRODUCTION_DAEMON_PORT}, in any form`,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// This flow is discoverable and runnable, but deliberately outside T37F's
// ten-flow sharded exit gate (see the yaml's own header comment and
// shard-plan.ts's NON_EXIT_GATE_FLOW_NAMES).
// ---------------------------------------------------------------------------
describe("file-download is a real, runnable, but non-exit-gate flow", () => {
  it("the real flow registry can resolve it by name", () => {
    const registry = createFlowRegistry();
    expect(registry.listFlowNames()).toContain("file-download");
    expect(() => registry.resolveFlowPath("file-download")).not.toThrow();
  });

  it("the exit gate's ten-flow set still excludes it (and still has exactly ten members)", () => {
    const exitGateFlows = listExitGateFlowNames();
    expect(exitGateFlows).toHaveLength(10);
    expect(exitGateFlows).not.toContain("file-download");
  });
});

// ---------------------------------------------------------------------------
// The download path itself, proven directly against the REAL controller —
// what the device cannot show today (see the yaml's header comment), a
// contract test still can with real production code, never a device, but
// never a reimplementation either.
// ---------------------------------------------------------------------------

/** A `DownloadStreamReader` over fixed chunks, delivered one `read()` at a time — real chunked-stream shape, not a single-shot resolve. */
function createFixedChunkReader(chunks: Uint8Array[]): DownloadStreamReader {
  let index = 0;
  return {
    read: async () => {
      if (index >= chunks.length) return { done: true };
      const value = chunks[index];
      index += 1;
      return { done: false, value };
    },
  };
}

describe("createFileDownloadController — the real download path a device can't show today", () => {
  it("a real file selection over a real HTTP origin: requests a token, streams real chunks, and the assembled bytes match what a DownloadPanel press would produce", async () => {
    const fileBytes = new TextEncoder().encode("file-download flow payload");
    const half = Math.ceil(fileBytes.length / 2);
    const chunks = [fileBytes.slice(0, half), fileBytes.slice(half)];

    const requestedUrls: string[] = [];
    const client: FileBrowserClient = {
      listDirectory: () => Promise.reject(new Error("not used")),
      requestDownloadToken: async (cwd, path) => ({
        cwd,
        path,
        token: "e2e-download-token",
        fileName: "download.txt",
        mimeType: "text/plain",
        size: fileBytes.length,
        error: null,
      }),
    };
    // A real-shaped daemon HTTP origin (never the production daemon's
    // port) — matches SessionFilesRoute's own `buildDaemonHttpOrigin`
    // output shape (`http://<host>:<port>`), never fabricated as a bare
    // hostname.
    const downloadOrigin = "http://10.0.2.2:54217";
    const fetchImpl: DownloadFetch = async (url) => {
      requestedUrls.push(url);
      return { ok: true, status: 200, body: { getReader: () => createFixedChunkReader(chunks) } };
    };

    const controller = createFileDownloadController({ client, downloadOrigin, fetchImpl });
    // Exactly what DownloadPanel's "Download" button calls
    // (`controller.download(workspaceRoot, entry.path, entry.name)`,
    // `files-screen.tsx`) for a real, listed file row.
    controller.download("/workspace/root", "notes/download.txt", "download.txt");

    // Flush the token request microtask, then the fetch/stream microtasks.
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("success");
    expect(state.progress).toBe(1);
    expect(state.file).not.toBeNull();
    const file = state.file as DownloadedFile;
    expect(new TextDecoder().decode(file.bytes)).toBe("file-download flow payload");
    expect(file.fileName).toBe("download.txt");
    expect(requestedUrls).toEqual([
      "http://10.0.2.2:54217/api/files/download?token=e2e-download-token",
    ]);
  });

  it("T66's named relay refusal: a relay-paired session with no origin reaches the exact copy this flow's yaml would assert if it could reach it, and never calls fetch", async () => {
    let fetchCalls = 0;
    const fetchImpl: DownloadFetch = async () => {
      fetchCalls += 1;
      throw new Error("must never be called — the refusal happens before any byte fetch");
    };
    const client: FileBrowserClient = {
      listDirectory: () => Promise.reject(new Error("not used")),
      requestDownloadToken: async (cwd, path) => ({
        cwd,
        path,
        token: "e2e-relay-token",
        fileName: "download.txt",
        mimeType: "text/plain",
        size: 12,
        error: null,
      }),
    };

    const controller = createFileDownloadController({
      client,
      downloadOrigin: null,
      connectionPath: "relay",
      fetchImpl,
    });
    controller.download("/workspace/root", "notes/download.txt", "download.txt");
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.error).toEqual(explainFileDownloadError(FILE_DOWNLOAD_NO_RELAY_ORIGIN));
    expect(state.error?.title).toBe(FILE_DOWNLOAD_FLOW.relayRefusalTitle);
    expect(state.error?.description).toBe(FILE_DOWNLOAD_FLOW.relayRefusalDescription);
    expect(fetchCalls).toBe(0);
  });
});
