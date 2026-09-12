/**
 * plan.md §8.4/§12.4 terminal scenarios, T30A1-T30A3/T53A5, and this
 * task's own three acceptance criteria (T31C3).
 *
 * `ui/shell.tsx` links the open session to
 * `/h/:serverId/session/:agentId/terminal/new`, and the terminal route
 * lists the session's terminals and creates one when the requested id is
 * not among them. This spec still creates its terminal through the
 * daemon's public RPC and opens the route by URL, because it needs a
 * specific, known terminal id to drive typed input into (rather than
 * whichever terminal the route would create) — the same
 * direct-deep-link pattern every other T31B/T31C spec uses
 * (`approvals.spec.ts`, `session-lifecycle.spec.ts`).
 *
 * A terminal is a real, spawned `node-pty` shell process
 * (`packages/server/src/terminal/terminal.ts`) -- unlike the fake `pi`
 * provider used for agent sessions in this harness
 * (`fixtures/fake-pi-agent-client.ts`), there is no terminal fake. Every
 * scenario below therefore proves a real end-to-end round trip: real
 * keystrokes over the real binary WS channel, into a real shell, and
 * real output rendered back by xterm's DOM renderer.
 *
 * On "closing the route disposes the terminal without leaking a
 * process": unsubscribing a terminal is, by design, NOT the same as
 * killing it. `handleUnsubscribeTerminalRequest`
 * (`packages/server/src/terminal/terminal-session-controller.ts:707-709`)
 * only detaches this connection's stream (`detachStream(id, {emitExit:
 * false})`); the daemon's only kill path
 * (`killTerminalForClose`, same file, invoked from `session.ts:2659`) is
 * reached from a separate `close_items_request` flow that nothing in
 * `apps/web/src` ever sends. Terminals are meant to survive navigating
 * away and back. A test that expected the OS-level shell process to
 * exit when this route unmounts would be asserting a product
 * regression, not this criterion -- so the third scenario below proves
 * the honestly-observable half of "disposes...without leaking": the
 * per-connection stream subscription is released (an explicit
 * `unsubscribe_terminal_request` goes out, proven from the wire) and no
 * further output is delivered to a page that no longer displays it,
 * even though the terminal itself, and its output, keep going for
 * another live subscriber.
 */
import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";
import {
  decodeBinaryFrame,
  decodeTerminalResizePayload,
  TerminalStreamOpcode,
} from "@picompanion/protocol/binary-frames/index";
import { buildDaemonWebSocketUrl } from "@picompanion/protocol/daemon-endpoints";

import { connectViaUi } from "./fixtures/connect-ui.js";
import { seedSession, type SeededSession } from "./fixtures/seed-session.js";
import { expect, test } from "./fixtures/test.js";
import type { DaemonConnection } from "./fixtures/test.js";

interface DecodedResizeFrame {
  rows: number;
  cols: number;
  intent?: "claim" | "update";
}

/**
 * Turns a Playwright WS frame payload into bytes, or `null` for a text
 * (JSON) frame -- every terminal stream frame (output/input/resize/
 * snapshot/restore) is binary (`terminal-stream-router.ts`'s
 * `encodeInput`, `demux.ts`'s `decodeBinaryFrame`), so a string payload
 * is always some other JSON-envelope message, never one of these.
 */
function frameBytes(payload: string | Buffer): Uint8Array | null {
  if (typeof payload === "string") {
    return null;
  }
  // `Buffer` is a view over a (possibly pooled, larger) `ArrayBuffer`;
  // slicing by `byteOffset`/`byteLength` is required to avoid reading
  // neighbouring pooled data as part of this frame.
  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
}

/**
 * Seeds a real agent (so the daemon's workspace registry already knows
 * the `cwd` a terminal can be created against, per
 * `resolveLegacyTerminalWorkspaceId`,
 * `terminal-session-controller.ts:586-608`), creates a real terminal on
 * that seed connection, then opens `/h/:serverId/session/:agentId/
 * terminal/:terminalId` in `page` and waits for the real "Connected"
 * status. Also wires up a resize-frame collector on the daemon
 * WebSocket this navigation opens, for scenario 2's use -- attached
 * unconditionally (cheap, and every scenario benefits from proving it
 * starts at zero) rather than duplicated per test.
 *
 * `createTerminal` is called with NO `agentId` option: passing one
 * makes the daemon reject the create outright ("Agent-backed terminals
 * are no longer supported",
 * `terminal-session-controller.ts:522-531`) -- this app's terminals are
 * plain workspace terminals, not agent-attached ones.
 */
async function openConnectedTerminal(
  page: Page,
  daemonConnection: DaemonConnection,
  label: string,
  options?: {
    /**
     * Invoked once, synchronously, with the app's real daemon
     * WebSocket -- from inside the same pre-`page.goto` `page.on(
     * "websocket", ...)` registration this function already uses for
     * its own resize-frame collectors. A caller that needs to observe
     * *every* frame this socket ever sends or receives (not just
     * resize ones) must attach through here rather than adding its own
     * `page.on("websocket", ...)` after this function returns: by then
     * the socket already exists, `page.on("websocket")` only fires once
     * at creation, and a late listener would silently see nothing.
     */
    onSocket?: (ws: import("@playwright/test").WebSocket) => void;
  },
): Promise<{
  session: SeededSession;
  terminalId: string;
  resizeFramesSent: DecodedResizeFrame[];
  resizeFramesReceived: DecodedResizeFrame[];
}> {
  await connectViaUi(page, daemonConnection, label);

  const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
  const created = await session.client.createTerminal(session.cwd, "e2e-terminal");
  expect(created.error).toBeNull();
  expect(created.terminal).not.toBeNull();
  const terminalId = created.terminal!.id;

  // The isolated daemon's own `ws://.../ws` origin, built the exact same
  // way `DaemonClientProvider`'s real connection (and this module's own
  // seed client) build it -- so this filter matches the app's real
  // socket, not e.g. Playwright's devtools/tracing sockets.
  const wsUrl = buildDaemonWebSocketUrl(daemonConnection.address, { useTls: false });
  const resizeFramesSent: DecodedResizeFrame[] = [];
  const resizeFramesReceived: DecodedResizeFrame[] = [];

  // Registered *before* `page.goto` below: that `goto` is a full,
  // non-SPA navigation away from `connectViaUi`'s `/connect` page (a
  // fresh URL, not a client-side route change), so it tears down the
  // `/connect` page's socket and `DaemonClientProvider` opens a brand
  // new one on the freshly-loaded terminal route, picking the
  // just-persisted host profile back up
  // (`connect-ui.ts`'s own doc comment). Listening from before that
  // navigation guarantees this test observes every frame that new
  // socket ever sends or receives, from its very first one.
  page.on("websocket", (ws) => {
    if (ws.url() !== wsUrl) {
      return;
    }
    ws.on("framesent", ({ payload }) => {
      const bytes = frameBytes(payload);
      if (!bytes) return;
      const decoded = decodeBinaryFrame(bytes);
      if (decoded?.kind !== "terminal" || decoded.frame.opcode !== TerminalStreamOpcode.Resize) {
        return;
      }
      const resize = decodeTerminalResizePayload(decoded.frame.payload);
      if (resize) resizeFramesSent.push(resize);
    });
    ws.on("framereceived", ({ payload }) => {
      const bytes = frameBytes(payload);
      if (!bytes) return;
      const decoded = decodeBinaryFrame(bytes);
      if (decoded?.kind !== "terminal" || decoded.frame.opcode !== TerminalStreamOpcode.Resize) {
        return;
      }
      const resize = decodeTerminalResizePayload(decoded.frame.payload);
      if (resize) resizeFramesReceived.push(resize);
    });
    options?.onSocket?.(ws);
  });

  await page.goto(
    `${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}/terminal/${terminalId}`,
  );
  await expect(page.getByTestId("terminal-view-status")).toContainText("Connected", {
    timeout: 15_000,
  });

  return { session, terminalId, resizeFramesSent, resizeFramesReceived };
}

test.describe("terminal", () => {
  test("opens against the isolated daemon and echoes typed input back through the real shell", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    const { session, terminalId } = await openConnectedTerminal(
      page,
      daemonConnection,
      "Terminal Echo Daemon",
    );
    try {
      // Clicking anywhere in the mounted terminal surface focuses
      // xterm's own hidden helper textarea (its standard focus
      // behaviour), which is what actually receives the keyboard events
      // Playwright dispatches next.
      const terminalSurface = page.getByTestId("terminal-view");
      await terminalSurface.click();

      // `echo` is a builtin on both shells this daemon can pick as its
      // default (`cmd.exe` on win32, `/bin/sh` elsewhere --
      // `resolveDefaultTerminalShell`, `terminal.ts:233-243`), so this
      // command is safe regardless of which platform the daemon under
      // test is running on. The token is unique per run so this
      // assertion can only pass if these specific keystrokes made a
      // full round trip through the real PTY and back, not some stale
      // leftover output from an earlier test sharing this run's one
      // daemon.
      const token = `E2ETERM${randomUUID().replace(/-/g, "").slice(0, 10)}`;
      await page.keyboard.type(`echo ${token}`);
      await page.keyboard.press("Enter");

      // `.xterm-rows` is `@xterm/xterm`'s own DOM-renderer row
      // container class (verified in the bundled
      // `node_modules/@xterm/xterm/lib/xterm.js`, where it's the
      // literal constant paired with the DOM renderer's
      // `xterm-dom-renderer-owner-` prefix). `apps/web/package.json`
      // loads no canvas/webgl addon, so this is real, visible DOM text
      // -- not a canvas pixel a test can't inspect -- proving the
      // shell's real output rendered back into the page.
      await expect(terminalSurface.locator(".xterm-rows")).toContainText(token, {
        timeout: 10_000,
      });
    } finally {
      // Real `node-pty` shells outlive route navigation by design (this
      // file's own module doc comment), so nothing the app itself sends
      // ever kills them -- unlike every other T31B/T31C fixture's `cwd`,
      // this one is still a live process's working directory when the
      // test ends. `killTerminal` (`kill_terminal_request` ->
      // `killTerminalForClose`, `terminal-session-controller.ts:253-258`)
      // is the same public RPC a real "close terminal" affordance would
      // call; using it here before `session.close()`'s `rm(cwd, ...)`
      // is what actually reclaims the process, not a tolerance hack.
      await session.client.killTerminal(terminalId).catch(() => undefined);
      await session.close();
    }
  });

  test("resize is computed and owned by the browser only, with no resize echo or loop", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    const { session, terminalId, resizeFramesSent, resizeFramesReceived } =
      await openConnectedTerminal(page, daemonConnection, "Terminal Resize Daemon");
    try {
      // The initial size claim rides inside `subscribe_terminal_request`'s
      // own `restore.size` field, not a separate wire resize frame
      // (`terminal-view.tsx`'s `mountXterm`: `fitAddon.fit()` runs, and
      // the controller subscribes with that size, *before* xterm's own
      // `onResize` listener is even attached -- so nothing the initial
      // mount does can itself emit a resize frame). Confirming zero here
      // proves that: no resize frame preceded any explicit,
      // user-visible size change.
      expect(resizeFramesSent).toHaveLength(0);

      // The wire protocol has no server -> client resize message at all
      // (`ServerMessage` in `packages/server/src/terminal/terminal.ts:
      // 66-71` is only `output`/`snapshot`/`snapshotReady`/
      // `titleChange`) -- the daemon's size arbiter
      // (`terminal-size-ownership.ts`) only ever *applies* rows/cols to
      // the PTY, it never echoes a resize frame back over this
      // connection's own socket. This asserts that directly from the
      // wire rather than trusting the type system: if this ever
      // regressed into a echo, this frame would show up here as
      // `resizeFramesReceived`.
      expect(resizeFramesReceived).toHaveLength(0);

      // A real viewport change well under the shell's ~60rem/~960px
      // content cap (`apps/web/src/styles/global.css:38`), so the
      // terminal surface's actual pixel width changes and xterm's
      // `FitAddon` recomputes a different cols/rows -- this is the one
      // and only thing that is supposed to trigger an outgoing resize.
      await page.setViewportSize({ width: 600, height: 700 });
      await expect.poll(() => resizeFramesSent.length, { timeout: 10_000 }).toBe(1);
      // Ownership was already established by the initial subscribe
      // (`TerminalResizeOwnership.markSubscribed()`,
      // `terminal-resize-ownership.ts:57-64`), so a passive
      // container/window fit must never re-claim it -- every resize
      // after the first one is an `"update"`, never another `"claim"`.
      expect(resizeFramesSent[0]?.intent).toBe("update");

      // A second, distinctly different viewport change.
      await page.setViewportSize({ width: 850, height: 700 });
      await expect.poll(() => resizeFramesSent.length, { timeout: 10_000 }).toBe(2);
      expect(resizeFramesSent[1]?.intent).toBe("update");

      // Settle window: nothing external prompts a resize besides the
      // browser's own `window` resize listener
      // (`terminal-view.tsx:203-204`), so a genuine claim/update
      // ping-pong loop would keep growing this count on its own even
      // with no further viewport changes from this test. Holding at
      // exactly 2 here is the "no resize loop" half of this
      // criterion -- paired with the two positive, content-checked
      // frames above, not standing in for them.
      await page.waitForTimeout(500);
      expect(resizeFramesSent).toHaveLength(2);
      expect(resizeFramesReceived).toHaveLength(0);
    } finally {
      // See the first scenario's `finally` for why this real `node-pty`
      // shell needs an explicit kill before `session.close()`'s `rm(cwd,
      // ...)` -- it outlives route navigation by design and nothing else
      // in this run ever kills it.
      await session.client.killTerminal(terminalId).catch(() => undefined);
      await session.close();
    }
  });

  test("closing the route unsubscribes the terminal stream without leaking output to the page that navigated away", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    // Declared before `openConnectedTerminal` so the `onSocket` hook
    // below can close over them: that hook runs from inside the same
    // pre-`page.goto` `page.on("websocket", ...)` registration
    // `openConnectedTerminal` already uses for its own resize
    // collectors (see that function's doc comment) -- registering a
    // *second*, separate `page.on("websocket", ...)` here, after
    // `openConnectedTerminal` has already returned, would attach after
    // the app's real socket was created and silently observe nothing,
    // since Playwright's `"websocket"` page event fires exactly once,
    // at creation.
    const sentSessionMessages: unknown[] = [];
    const outputTextReceived: string[] = [];
    const { session, terminalId } = await openConnectedTerminal(
      page,
      daemonConnection,
      "Terminal Dispose Daemon",
      {
        onSocket: (ws) => {
          ws.on("framesent", ({ payload }) => {
            if (typeof payload !== "string") return;
            try {
              sentSessionMessages.push(JSON.parse(payload));
            } catch {
              // Not a JSON session envelope (e.g. a ping); irrelevant here.
            }
          });
          ws.on("framereceived", ({ payload }) => {
            const bytes = frameBytes(payload);
            if (!bytes) return;
            const decoded = decodeBinaryFrame(bytes);
            if (
              decoded?.kind === "terminal" &&
              decoded.frame.opcode === TerminalStreamOpcode.Output
            ) {
              // Kept as decoded text, not merely counted: a bare count
              // cannot tell a leaked subscription apart from a shell
              // prompt redraw that was already in flight when the count
              // was sampled. The text can -- see the final assertions.
              outputTextReceived.push(new TextDecoder().decode(decoded.frame.payload));
            }
          });
        },
      },
    );
    try {
      // Prove the stream is genuinely live on this page *before*
      // closing it -- otherwise a later "zero further output frames"
      // check would be vacuous (it could just mean nothing ever worked).
      const terminalSurface = page.getByTestId("terminal-view");
      await terminalSurface.click();
      const beforeToken = `E2EBEFORE${randomUUID().replace(/-/g, "").slice(0, 8)}`;
      await page.keyboard.type(`echo ${beforeToken}`);
      await page.keyboard.press("Enter");
      await expect(terminalSurface.locator(".xterm-rows")).toContainText(beforeToken, {
        timeout: 10_000,
      });
      expect(outputTextReceived.length).toBeGreaterThan(0);

      // A real, in-app SPA navigation away from the terminal route --
      // the shell's header brand renders a persistent `<Link to=
      // "/connect">` on every screen (`shell.tsx:103-105`), and
      // `DaemonClientProvider` sits above `RouterProvider`
      // (`App.tsx:14-22`), so this click unmounts `TerminalView` while
      // the exact same WebSocket connection this test is watching stays
      // open -- exactly the case `TerminalController.dispose()`'s
      // cleanup exists for.
      await page.getByRole("link", { name: "Pi Companion", exact: true }).click();
      await expect(page).toHaveURL(`${daemonConnection.webBaseUrl}/connect`);

      // Direct, positive proof `dispose()` ran: the exact envelope
      // `sendSessionMessage` wraps every session-scoped request in
      // (`daemon-client.ts:1613-1622`) carrying an
      // `unsubscribe_terminal_request` for this terminal
      // (`terminal-controller.ts:258-260`'s `dispose()` calling
      // `client.unsubscribeTerminal`, `daemon-client.ts:5031-5037`).
      await expect
        .poll(
          () =>
            sentSessionMessages.some(
              (message) =>
                typeof message === "object" &&
                message !== null &&
                (message as { type?: unknown }).type === "session" &&
                (message as { message?: { type?: unknown; terminalId?: unknown } }).message
                  ?.type === "unsubscribe_terminal_request" &&
                (message as { message?: { terminalId?: unknown } }).message?.terminalId ===
                  terminalId,
            ),
          { timeout: 10_000 },
        )
        .toBe(true);

      // Now prove the terminal itself is still genuinely alive and
      // producing fresh output -- via a *second*, independent
      // subscription on the still-open seed `DaemonClient` -- while the
      // disposed page's own socket gets none of it. A leaked
      // subscription on the disposed page would keep delivering this
      // same fresh output there too; a correctly disposed one won't.
      const subscribed = await session.client.subscribeTerminal(terminalId, {
        restore: { mode: "live" },
      });
      expect(subscribed.error).toBeNull();

      const afterToken = `E2EAFTER${randomUUID().replace(/-/g, "").slice(0, 8)}`;
      const seedSawFreshOutput = session.client.waitForTerminalStreamEvent((event) => {
        if (event.terminalId !== terminalId || event.type !== "output") {
          return false;
        }
        return new TextDecoder().decode(event.data).includes(afterToken);
      }, 10_000);
      session.client.sendTerminalInput(terminalId, { type: "input", data: `echo ${afterToken}\r` });
      await seedSawFreshOutput;

      // The load-bearing assertion, and the reason this scenario reads
      // frame *content* rather than counting frames: `afterToken` is
      // generated only after the `unsubscribe_terminal_request` was
      // proven on the wire above, so no frame carrying it can be a
      // straggler that was already in flight when the stream was
      // released. If the disposed page's subscription had leaked, this
      // text would have been delivered there too, exactly as it was to
      // the still-live seed subscriber.
      //
      // (An earlier revision asserted a frame-count equality across the
      // close instead. That is unsound on Windows: `cmd.exe` emits a
      // prompt redraw a beat after the `beforeToken` text lands, so two
      // legitimate pre-unsubscribe frames could arrive after the count
      // was sampled and read as a leak. Do not reintroduce it, and do
      // not paper over it with a settle sleep.)
      expect(outputTextReceived.some((text) => text.includes(afterToken))).toBe(false);

      // Bounded follow-up, now that the stream is provably quiescent: a
      // full request/response round trip has completed since the
      // unsubscribe went out, so anything in flight from before it has
      // long since landed. A second echo therefore moves this counter
      // only if the page's stream is genuinely still attached.
      const quiescentFrameCount = outputTextReceived.length;
      const secondToken = `E2EAFTER2${randomUUID().replace(/-/g, "").slice(0, 8)}`;
      const seedSawSecondOutput = session.client.waitForTerminalStreamEvent((event) => {
        if (event.terminalId !== terminalId || event.type !== "output") {
          return false;
        }
        return new TextDecoder().decode(event.data).includes(secondToken);
      }, 10_000);
      session.client.sendTerminalInput(terminalId, {
        type: "input",
        data: `echo ${secondToken}\r`,
      });
      await seedSawSecondOutput;
      expect(outputTextReceived.length).toBe(quiescentFrameCount);
    } finally {
      // Deliberately still alive here (that liveness is what the
      // scenario just proved via the seed subscription) -- clean it up
      // the same way as the other two scenarios, see that `finally`'s
      // comment for why.
      await session.client.killTerminal(terminalId).catch(() => undefined);
      await session.close();
    }
  });
});
