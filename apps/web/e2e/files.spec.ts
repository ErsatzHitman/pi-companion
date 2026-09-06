/**
 * T31C4 — plan.md §12.4 (file browser over daemon RPC, never touching the
 * laptop's paths directly) and §14.3's file-browser scenario family.
 *
 * This spec owns `apps/web/e2e/files.spec.ts` only.
 *
 * ---
 *
 * **Two of this task's three acceptance criteria are genuinely blocked
 * today, not just hard to reach.** `HostSessionFilesScreen`
 * (`apps/web/src/routes/screens/host-session-files-screen.tsx:34-45`) never
 * resolves or passes a session's real daemon-side workspace root, so
 * `FileBrowserScreen` falls back to its own placeholder default,
 * `workspaceRoot = ""` (`apps/web/src/features/files/file-browser-screen.tsx:94`).
 * Every `listDirectory`/`readFile` call the real `/files` route issues
 * therefore always sends `cwd: ""` — no matter what real cwd the session
 * actually has — and the daemon refuses that outright with `"cwd is
 * required"` before ever touching the filesystem
 * (`packages/server/src/server/session/files/workspace-files-session.ts:141-159`,
 * the `handleFileExplorerRequest` guard). `host-session-files-screen.tsx`'s
 * own doc comment (lines 24-30) names the root cause: resolving a
 * session's real workspace root depends on
 * `packages/frontend-core/src/sessions/index.ts:15`
 * (`SESSIONS_DOMAIN_STUB = true`), which per `docs/issues-from-plan.md`
 * doesn't land until T38A1 (phase 6 — well after this phase-4 task).
 * Fixing this means editing `host-session-files-screen.tsx` and/or the
 * sessions domain, both outside the one file (`files.spec.ts`) this task
 * owns.
 *
 * That blocks:
 *   - "Browsing, opening and editing a file all round-trip over daemon
 *     RPC" — the browser can never successfully list a directory at all,
 *     so there is nothing to open or edit through the real UI.
 *   - "A large file degrades to a bounded view rather than freezing the
 *     browser" — the browser can never reach a real file's content view
 *     (large or otherwise) to prove the size cap fires.
 *
 * Per this repo's house rule against faking a scenario or silently
 * dropping it, both are written below as `test.fixme(...)` with a real,
 * type-checked body: the exact flow that would need to pass once
 * `workspaceRoot` resolution lands, spelled out selector-by-selector so it
 * can be flipped to `test(...)` the day that gap closes. They do not run
 * today and must not be un-skipped until that gap is fixed elsewhere.
 *
 * The third criterion — "a path outside the allowed root is refused, and
 * there is no second, weaker path that bypasses the check" — does *not*
 * depend on that gap: it is a security property of the daemon's RPC
 * surface itself, reachable directly with a second, independent
 * `DaemonClient` the same way `seed-session.ts` already seeds every other
 * spec's preconditions. It is fully covered below, including a real
 * product defect this spec found while reading every file RPC rather than
 * only the one the UI happens to call (see "an empty cwd on the write and
 * subscribe RPCs..." below).
 */
import {
  mkdtemp,
  readFile as readFileNode,
  rm,
  writeFile as writeFileNode,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { expect, test } from "./fixtures/test.js";
import { connectViaUi } from "./fixtures/connect-ui.js";
import { seedSession } from "./fixtures/seed-session.js";

test.describe("file browser", () => {
  // ==========================================================================
  // Blocked pending T38A1 (see this file's module doc for the full trace).
  // ==========================================================================

  test.fixme("browsing, opening and editing a file all round-trip over daemon RPC", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    await connectViaUi(page, daemonConnection, "Files Round Trip Daemon");

    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      // The fake Pi provider never creates files on its own
      // (`fake-pi-agent-client.ts`); the file this scenario browses,
      // opens, and edits has to exist on disk before the browser ever
      // navigates there.
      const filePath = path.join(session.cwd, "notes.txt");
      await writeFileNode(filePath, "original contents\n", "utf8");

      await page.goto(
        `${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}/files/`,
      );

      // Once `workspaceRoot` resolves to `session.cwd`, the first
      // successful directory listing *is* this route's own round-trip
      // proof — unlike the session route, `/files` renders no
      // `SessionResumeScreen` gate to wait on first (see the module doc).
      // `FileBrowserEntryList` keys its testid on the entry's path
      // relative to the workspace root (`file-browser-entry-list.tsx:38`),
      // which for a file at the workspace root is just its own name.
      const entry = page.getByTestId("file-browser-entry-notes.txt");
      await expect(entry).toBeVisible({ timeout: 15_000 });
      await entry.click();

      const contentView = page.getByTestId("file-content-view");
      await expect(contentView).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("file-content-code")).toContainText("original contents");

      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const editorContent = page.getByLabel(`Edit ${path.basename(filePath)}`);
      await expect(editorContent).toBeVisible({ timeout: 10_000 });
      await editorContent.click();
      await page.keyboard.press("Control+A");
      await page.keyboard.type("edited by the e2e round trip");

      await page.getByRole("button", { name: "Save", exact: true }).click();

      // Saving returns the panel to read mode showing the daemon's own
      // reload of the file (`onSaved` -> `controller.retry`), not just
      // the submitted buffer echoed back client-side.
      await expect(page.getByTestId("file-editor-panel")).toContainText(
        "edited by the e2e round trip",
        { timeout: 10_000 },
      );

      // The concrete "round trip" proof: independently re-read the file
      // from disk with Node, outside the browser entirely, to prove the
      // daemon actually persisted the edit rather than the UI merely
      // updating its own local state.
      const persisted = await readFileNode(filePath, "utf8");
      expect(persisted).toBe("edited by the e2e round trip");
    } finally {
      await session.close();
    }
  });

  test.fixme("a large file degrades to a bounded view rather than freezing the browser", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    await connectViaUi(page, daemonConnection, "Large File Daemon");

    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      // MAX_PREVIEWABLE_FILE_BYTES = 1024 * 1024
      // (apps/web/src/features/files/file-read-client.ts:66) — this file
      // sits comfortably over that cap.
      const filePath = path.join(session.cwd, "big.log");
      await writeFileNode(filePath, "x".repeat(1_536_000), "utf8");

      await page.goto(
        `${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}/files/big.log`,
      );

      // The refusal itself — the client-side cap firing, not a daemon
      // error. (The daemon's own read path streams in bounded 256 KB
      // chunks — `FILE_EXPLORER_STREAM_CHUNK_BYTES`,
      // packages/server/src/server/file-explorer/service.ts:96 — so it
      // needs no separate assertion here.)
      const refused = page.getByTestId("file-content-refused");
      await expect(refused).toBeVisible({ timeout: 15_000 });
      await expect(refused).toContainText("This file is too large to preview");

      // The full 1.5 MB of content was never pushed into the DOM as a
      // rendered code block.
      await expect(page.getByTestId("file-content-code")).toHaveCount(0);

      // The concrete "did not freeze" proof: the page is still
      // responsive to a real interaction afterward. A hung renderer
      // would fail this follow-up click within its own timeout instead
      // of navigating back to the folder listing.
      await page
        .getByRole("navigation", { name: "Breadcrumb" })
        .getByRole("link", { name: "Files" })
        .click();
      await expect(page.getByTestId("file-browser-entry-big.log")).toBeVisible({ timeout: 10_000 });
    } finally {
      await session.close();
    }
  });

  // ==========================================================================
  // "A path outside the allowed root is refused, and there is no second,
  // weaker path that bypasses the check."
  //
  // This does not depend on the workspaceRoot gap above: it is exercised
  // directly against the daemon's RPC surface with a second, independent
  // DaemonClient — the exact precondition-seeding pattern
  // fixtures/seed-session.ts already uses (a real round trip over the real
  // wire protocol, not a mock). Every entry point that reads or writes a
  // file funnels through one choke point, `resolveScopedPath`
  // (packages/server/src/server/file-explorer/service.ts:575-602), which
  // throws ACCESS_OUTSIDE_WORKSPACE_MESSAGE = "Access outside of workspace
  // is not allowed" (service.ts:100) for any resolved path that lands
  // outside the scoping root. Five entry points reach it:
  //   - DaemonClient.listDirectory  (throws)
  //   - DaemonClient.readFile       (throws)
  //   - DaemonClient.writeFile      (resolves { status: "error" })
  //   - DaemonClient.requestDownloadToken (resolves with .error set)
  //   - DaemonClient.subscribeFile  (resolves { initial: { status: "error" } })
  // (packages/client/src/daemon-client.ts:4250,4266,4318,4395,4288.)
  // ==========================================================================

  test("every read, list, write, download-token, and subscribe entry point refuses a `../` escape out of the session's workspace", async ({
    daemonConnection,
  }) => {
    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      const client = session.client;
      const cwd = session.cwd;
      const ESCAPE = "Access outside of workspace is not allowed";
      const outsidePath = "../outside.txt";

      await expect(client.listDirectory(cwd, outsidePath)).rejects.toThrow(ESCAPE);
      await expect(client.readFile(cwd, outsidePath)).rejects.toThrow(ESCAPE);

      const writeResult = await client.writeFile({
        cwd,
        path: outsidePath,
        content: "should never be written",
        expectedModifiedAt: new Date().toISOString(),
      });
      expect(writeResult.status).toBe("error");
      expect((writeResult as { status: "error"; error: string }).error).toBe(ESCAPE);

      const tokenResult = await client.requestDownloadToken(cwd, outsidePath);
      expect(tokenResult.error).toBe(ESCAPE);
      expect(tokenResult.token).toBeNull();

      const subscribeResult = await client.subscribeFile({ cwd, path: outsidePath }, () => {});
      expect(subscribeResult.initial.status).toBe("error");
      expect((subscribeResult.initial as { status: "error"; error: string }).error).toBe(ESCAPE);
      subscribeResult.unsubscribe();
    } finally {
      await session.close();
    }
  });

  test("every entry point refuses an absolute path outside the session's workspace, not just a relative `..` escape", async ({
    daemonConnection,
  }) => {
    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    // A sibling temp directory, deliberately *not* under `session.cwd`, with
    // a real file in it — the absolute-path escape target. If any entry
    // point's guard only rejected `..` segments (a weaker check than "does
    // the resolved path stay under the root"), an absolute path to this
    // file would sail straight through it.
    const siblingDir = await mkdtemp(path.join(os.tmpdir(), "picompanion-e2e-outside-"));
    const siblingFile = path.join(siblingDir, "secret.txt");
    await writeFileNode(siblingFile, "should never be reachable\n", "utf8");
    try {
      const client = session.client;
      const cwd = session.cwd;
      const ESCAPE = "Access outside of workspace is not allowed";

      await expect(client.listDirectory(cwd, siblingFile)).rejects.toThrow(ESCAPE);
      await expect(client.readFile(cwd, siblingFile)).rejects.toThrow(ESCAPE);

      const writeResult = await client.writeFile({
        cwd,
        path: siblingFile,
        content: "should never overwrite the sibling file",
        expectedModifiedAt: new Date().toISOString(),
      });
      expect(writeResult.status).toBe("error");
      expect((writeResult as { status: "error"; error: string }).error).toBe(ESCAPE);

      const tokenResult = await client.requestDownloadToken(cwd, siblingFile);
      expect(tokenResult.error).toBe(ESCAPE);
      expect(tokenResult.token).toBeNull();

      const subscribeResult = await client.subscribeFile({ cwd, path: siblingFile }, () => {});
      expect(subscribeResult.initial.status).toBe("error");
      expect((subscribeResult.initial as { status: "error"; error: string }).error).toBe(ESCAPE);
      subscribeResult.unsubscribe();

      // And the sibling file itself was never touched by any of the above.
      const untouched = await readFileNode(siblingFile, "utf8");
      expect(untouched).toBe("should never be reachable\n");
    } finally {
      await session.close();
      await rm(siblingDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  // ==========================================================================
  // The real "second, weaker path" this criterion is checking for — this
  // *was* a genuine product defect, not a hypothetical, until the T31C4
  // repair pass closed it.
  //
  // `handleFileExplorerRequest` (workspace-files-session.ts:141-159) and
  // `handleFileDownloadTokenRequest` (workspace-files-session.ts:322-338)
  // both trim `cwd` and refuse an empty result with "cwd is required"
  // *before* ever resolving a path. `handleFileWriteRequest` and
  // `handleFileSubscribeRequest` used to skip that guard entirely — they
  // passed `request.cwd` straight through to `writeExplorerFile`/
  // `fileObserver.subscribe` with no presence check. Both protocol schemas
  // agree: `FileWriteRequestSchema.cwd` and `FileSubscribeRequestSchema.cwd`
  // are bare `z.string()` with no `.min(1)`
  // (packages/protocol/src/messages.ts:2351,2365), so an empty string
  // legitimately reaches the handler over the wire.
  //
  // The consequence used to be: `expandUserPath("")` resolves to
  // `path.resolve("")`, i.e. the *daemon process's own working directory*
  // (packages/server/src/server/path-utils.ts:14-19), and
  // `resolveScopedPath` (service.ts:575-602) then treated that as a fully
  // legitimate scoping root. A write or subscribe against `cwd: ""` was not
  // refused the way the other three entry points refuse it — it silently
  // substituted the daemon's own cwd as the effective workspace.
  //
  // This test proves the gap without ever mutating a real file: the probe
  // path below is a random name that cannot already exist, so a still-open
  // write against a resolved (non-empty) cwd would short-circuit on
  // `writeExplorerFile`'s own pre-write existence check and return
  // `{ status: "conflict", version: { status: "missing" } }` rather than
  // actually opening a file for writing. `subscribeFile` is read-only by
  // construction (it stats the target and starts a non-recursive
  // `fs.watch` on its parent directory, unsubscribed again in this test's
  // `finally`). Neither call touches the real filesystem.
  //
  // `handleFileWriteRequest` and `handleFileSubscribeRequest`
  // (workspace-files-session.ts) now carry the same `cwd.trim()` presence
  // guard `handleFileExplorerRequest` and `handleFileDownloadTokenRequest`
  // already had, emitting `"cwd is required"` before either RPC is
  // considered — the assertions below are the real, correct behavior and
  // this test now passes, guarding against the guard's regression.
  // ==========================================================================

  test("an empty cwd on the write and subscribe RPCs is refused the same way the other three entry points refuse it", async ({
    daemonConnection,
  }) => {
    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      const client = session.client;
      // Guaranteed not to already exist anywhere, so the probe can never
      // accidentally read or (as documented above) write a real file.
      const probePath = `picompanion-e2e-cwd-guard-probe-${randomUUID()}.txt`;

      const writeResult = await client.writeFile({
        cwd: "",
        path: probePath,
        content: "should be refused before this is ever considered",
        expectedModifiedAt: new Date().toISOString(),
      });
      expect(writeResult.status).toBe("error");
      expect((writeResult as { status: "error"; error: string }).error).toBe("cwd is required");

      const subscribeResult = await client.subscribeFile({ cwd: "", path: probePath }, () => {});
      try {
        expect(subscribeResult.initial.status).toBe("error");
        expect((subscribeResult.initial as { status: "error"; error: string }).error).toBe(
          "cwd is required",
        );
      } finally {
        subscribeResult.unsubscribe();
      }
    } finally {
      await session.close();
    }
  });
});
