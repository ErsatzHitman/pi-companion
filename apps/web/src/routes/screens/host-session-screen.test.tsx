import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

afterEach(cleanup);

import { CoreProvider } from "../../app/core-context.js";
import { routeTree } from "../route-tree.js";

/**
 * Warm the lazy route chunk BEFORE any assertion is timed. See
 * `host-sessions-screen.test.tsx` for the full rationale: cold dynamic-import
 * transform (~7s per route) inside `findBy*` made these route files flaky in
 * roughly half of full-suite runs. This moves the cost out of the timed window
 * rather than inflating the timeout to conceal it.
 */
beforeAll(async () => {
  await import("./host-session-screen.js");
}, 120_000);

/**
 * T28B3: proves `HostSessionScreen` (wired through the real, production
 * `routeTree`, the same way `host-session-files-screen.test.tsx` and
 * `host-session-terminal-screen.test.tsx`-equivalent route wiring is
 * proven for their own features) mounts the real composer rather than
 * only a placeholder stub `apps/web/src/features/composer` is
 * otherwise never reached from. `Composer.test.tsx`/`use-composer.test.ts`
 * cover the feature's own behavior in depth with injected fake clients;
 * this only proves the route delivers it, wired to this app's real
 * `platform.clock`/`platform.structuredStorage` (`ComposerContainer`).
 */
describe("HostSessionScreen route wiring (T28B3)", () => {
  it("renders the composer's labelled input and its Send control", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ["/h/host-1/session/agent-1"],
      }),
    });
    render(
      <CoreProvider>
        <RouterProvider router={router} />
      </CoreProvider>,
    );

    // Same generous, explicit ceiling `host-session-files-screen.test.tsx`
    // uses for a first lazy-route chunk import in a fresh test process.
    expect(await screen.findByLabelText("Message Pi", {}, { timeout: 15_000 })).toBeTruthy();
    // T386: the main column's `Section title="Session"` heading is gone —
    // the reference draws a `.main-head` row (title, status pill,
    // model/mode chips) with no heading above it. `Shell` still names the
    // route to assistive tech through its visually-hidden `<h1>`
    // ("Session transcript"), and the head row is pinned by its own test id
    // in `features/sessions`'s tests.
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  }, 20_000);

  /**
   * T105: this route must mount `EditFromHereSurface` (composing the
   * real transcript with the real `editFromHere` call site), not a bare
   * `<Transcript>` — the region this asserts on is the same
   * `data-testid="host-session-transcript"` node either would render
   * with no entries loaded (`Transcript`'s own `EmptyState` fallback), so
   * this only proves the region is mounted at all; deleting the mount
   * line removes it, failing this assertion — see this file's own
   * mutation proof in the task report.
   */
  it("mounts the edit-from-here transcript surface", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ["/h/host-1/session/agent-1"],
      }),
    });
    render(
      <CoreProvider>
        <RouterProvider router={router} />
      </CoreProvider>,
    );

    expect(
      await screen.findByTestId("host-session-transcript", {}, { timeout: 15_000 }),
    ).toBeTruthy();
  }, 20_000);
});

/**
 * fork-agent-ui: `edit-from-here-fork-client.ts`'s `adaptEditFromHereForkClient`
 * (own tests: `edit-from-here-fork-client.test.ts`) yields a defined client on
 * every connected render, so this route must actually hand that value to
 * `EditFromHereSurface` — otherwise the adapter's defined return would never
 * enable the button. A full render cannot observe this (this route's `client`
 * comes from a real `HostController` nothing here can inject — see the T284
 * block below for the same instrument), so this pins the wiring line at the
 * source level: deleting `client={editFromHereClient}` from the mount fails
 * this assertion.
 */
describe("HostSessionScreen edit-from-here live wiring (fork-agent-ui)", () => {
  it("derives editFromHereClient from the live client via adaptEditFromHereForkClient", () => {
    expect(readHostSessionScreenCode()).toMatch(
      /const editFromHereClient = useMemo\(\(\) => adaptEditFromHereForkClient\(client\), \[client\]\);/,
    );
  });

  it("passes the adapted client straight through to EditFromHereSurface — deleting it must fail this assertion", () => {
    const code = readHostSessionScreenCode();
    expect(code).toMatch(/<EditFromHereSurface[\s\S]*?client=\{editFromHereClient\}/);
    expect(code).not.toMatch(/<EditFromHereSurface[\s\S]*?client=\{undefined\}/);
  });
});

describe("HostSessionScreen transcribe wiring (T277 web close, T282 pattern)", () => {
  it("derives transcribeClient from the live client via resolveTranscribeClient", () => {
    expect(readHostSessionScreenCode()).toMatch(
      /const transcribeClient = useMemo\(\(\) => resolveTranscribeClient\(client\), \[client\]\);/,
    );
  });

  it("passes the resolved client straight through to ComposerContainer — deleting it must fail this assertion", () => {
    const code = readHostSessionScreenCode();
    expect(code).toMatch(/<ComposerContainer[\s\S]*?transcribeClient=\{transcribeClient\}/);
    expect(code).not.toMatch(/<ComposerContainer[\s\S]*?transcribeClient=\{undefined\}/);
  });

  it("records a transcript fork into the shared registry so SessionsScreen re-resolves it under its real parent", () => {
    const code = readHostSessionScreenCode();
    expect(code).toMatch(/recordForkRelationship\(outcome\.newSessionId/);
  });
});

/**
 * UI-W11: this route's raw `client` (the same live `DaemonClient` already
 * threaded to `editorTextClient` above) must also reach `ComposerContainer`'s
 * `sessionCostClient` prop, so `Composer`'s context-ring sheet can mount a
 * live `SessionCostMeterContainer` next to `ContextMeter` — see
 * `Composer.test.tsx`'s own coverage of that surface. A full render cannot
 * observe this wiring line for the same reason the transcribe/attachment-image
 * blocks above cannot: this route's `client` comes from a real
 * `HostController` nothing in this suite can inject.
 */
describe("HostSessionScreen session-cost wiring (UI-W11)", () => {
  it("passes the raw client straight through to ComposerContainer's sessionCostClient prop — deleting it must fail this assertion", () => {
    const code = readHostSessionScreenCode();
    expect(code).toMatch(/<ComposerContainer[\s\S]*?sessionCostClient=\{client \?\? undefined\}/);
  });
});

/**
 * T284: proves this route's attachment-image wiring — a source-level
 * contract test, the same instrument `CLAUDE.md` names for a behavior
 * that cannot be exercised through a full render. Everything ABOUT the
 * hook's correctness (a token request resolves a real fetchable URL,
 * never retries a failed one, resets on a connection change) already
 * has real, non-decorative proof in `attachment-image-resolver.test.ts`;
 * what is unproven anywhere else is that this ROUTE actually calls
 * `useAttachmentImageResolver` with the live `client`/`agentId`/
 * `transcriptEntries`/`downloadOrigin` and forwards the result to
 * `EditFromHereSurface`. A full render can't observe that: this route's
 * `client` comes from `useDaemonClientContext()`, backed by a real
 * `hosts.HostController` `DaemonClientProvider` constructs internally —
 * `daemon-client-context.tsx` exports no way to inject a fake one, and
 * that file is outside this task's owned files. The
 * "mounts the edit-from-here transcript surface" test above already
 * proves `EditFromHereSurface` itself renders with no live connection;
 * this only proves the wiring line, the same way
 * `edit-from-here-fork-client.test.ts` proves `adaptEditFromHereForkClient`
 * as a pure function rather than through the DOM.
 */
function readHostSessionScreenSource(): string {
  // `import.meta.url` is already a real `file:` URL string here; under
  // jsdom, `new URL(x, import.meta.url)` throws `ERR_INVALID_URL_SCHEME`
  // (see `../../ui/shell.test.tsx`'s identical comment/pattern).
  const path = join(dirname(fileURLToPath(import.meta.url)), "host-session-screen.tsx");
  return readFileSync(path, "utf8");
}

function readHostSessionScreenCode(): string {
  return readHostSessionScreenSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("HostSessionScreen attachment-image wiring (T284)", () => {
  it("imports resolveDirectHttpOrigin/useAttachmentImageResolver from features/transcript/attachment-image-resolver", () => {
    const code = readHostSessionScreenCode();
    expect(code).toMatch(
      /import \{\s*resolveDirectHttpOrigin,\s*useAttachmentImageResolver,?\s*\} from "\.\.\/\.\.\/features\/transcript\/attachment-image-resolver\.js";/,
    );
  });

  it("derives downloadOrigin from hostController.getCurrentProfile()/info.kind, never a hard-coded literal", () => {
    const code = readHostSessionScreenCode();
    expect(code).toMatch(
      /resolveDirectHttpOrigin\(hostController\?\.getCurrentProfile\(\) \?\? null, info\.kind\)/,
    );
  });

  it("calls useAttachmentImageResolver with the live client, this route's agentId, downloadOrigin, and transcriptEntries", () => {
    const code = readHostSessionScreenCode();
    expect(code).toMatch(
      /const resolveImageSrc = useAttachmentImageResolver\(\{\s*client,\s*agentId,\s*downloadOrigin,\s*entries: transcriptEntries,\s*\}\);/,
    );
  });

  it("passes the resolved resolveImageSrc straight through to EditFromHereSurface's own prop — deleting it must fail this assertion", () => {
    const code = readHostSessionScreenCode();
    expect(code).toMatch(/<EditFromHereSurface[\s\S]*?resolveImageSrc=\{resolveImageSrc\}/);
    expect(code).not.toMatch(/resolveImageSrc=\{undefined\}/);
  });
});

/**
 * Pi UI placement wiring (plan.md §11.3, §11.5). The three hosts' own
 * components are proven in `features/extensions/placements/*.test.tsx`;
 * what those cannot observe is that THIS route mounts them and feeds each
 * one the session's single shared `PiUiSessionProvider` value, rather than
 * a second store or a fixture. A full render cannot observe that here for
 * the same reason the attachment-image block above gives: this route's
 * client comes from a `HostController` nothing in this suite can inject.
 */
/**
 * FIX-W6: `RecoveredTurnBanner` reads a real `OutboxController` built from
 * this route's own `platform.structuredStorage`/`platform.clock` — the
 * same `useCore()` singleton `ComposerContainer` feeds `useComposer`'s own
 * outbox, so a send parked `awaiting-confirmation` by the composer is
 * visible here too. A full render cannot observe this construction (it
 * depends on `useCore()`'s real platform, not something this suite
 * injects a fake for), so this pins it at the source level, the same
 * instrument every other platform/client-derived wiring block in this file
 * already uses.
 */
describe("HostSessionScreen recovered-turn wiring (FIX-W6)", () => {
  it("builds the outbox from platform.structuredStorage/platform.clock — the same source ComposerContainer's outbox uses", () => {
    const code = readHostSessionScreenCode();
    expect(code).toMatch(
      /const recoveredTurnOutbox = useMemo\(\s*\(\) => new coreComposer\.OutboxController\(platform\.structuredStorage, platform\.clock\),/,
    );
  });

  it("mounts RecoveredTurnBanner above EditFromHereSurface, fed the same outbox instance", () => {
    const code = readHostSessionScreenCode();
    const bannerIndex = code.indexOf("<RecoveredTurnBanner");
    const transcriptIndex = code.indexOf("<EditFromHereSurface");
    expect(bannerIndex).toBeGreaterThan(-1);
    expect(transcriptIndex).toBeGreaterThan(bannerIndex);
    expect(code).toMatch(/<RecoveredTurnBanner[\s\S]*?turns=\{recoveredTurns\}/);
    expect(code).toMatch(/<RecoveredTurnBanner[\s\S]*?outbox=\{recoveredTurnOutbox\}/);
  });
});

/**
 * FIX-W8: `RecoveredTurnBanner`'s Resend action only flips an entry's
 * status back to `pending` (`confirmRecoveredTurn` -> `confirmResend`,
 * see `../../features/transcript/recovered-turn-banner.tsx`'s own module
 * doc); nothing pushed it over the wire until `usePendingOutboxResume`.
 * A full render cannot observe this wiring for the same reason every
 * other client/platform-derived block in this file gives (this route's
 * `client` comes from a real `HostController` nothing in this suite can
 * inject), so this pins it at the source level — the same instrument
 * the FIX-W6 block just above already uses for the sibling outbox wire.
 */
describe("HostSessionScreen pending-outbox resend wiring (FIX-W8)", () => {
  it("imports usePendingOutboxResume from features/composer/use-pending-outbox-resume", () => {
    const code = readHostSessionScreenCode();
    expect(code).toMatch(
      /import \{ usePendingOutboxResume \} from "\.\.\/\.\.\/features\/composer\/use-pending-outbox-resume\.js";/,
    );
  });

  it("builds it from the same agentTurnClient/recoveredTurnOutbox this route already constructs, plus the live connection status", () => {
    const code = readHostSessionScreenCode();
    expect(code).toMatch(/const pendingOutboxResume = usePendingOutboxResume\(\{/);
    expect(code).toMatch(/client: agentTurnClient,/);
    expect(code).toMatch(/outbox: recoveredTurnOutbox,/);
    expect(code).toMatch(/connectionStatus: info\.status,/);
  });

  it("wires RecoveredTurnBanner's onResendConfirmed to resumePending — deleting it must fail this assertion", () => {
    const code = readHostSessionScreenCode();
    expect(code).toMatch(
      /<RecoveredTurnBanner[\s\S]*?onResendConfirmed=\{\(\) => void pendingOutboxResume\.resumePending\(\)\}/,
    );
  });
});

describe("HostSessionScreen Pi UI placement wiring", () => {
  it("reads the one shared session value from usePiUiSession", () => {
    expect(readHostSessionScreenCode()).toMatch(/const piUiSession = usePiUiSession\(\);/);
  });

  it("mounts the screen, sheet, and inline hosts, each fed by the shared session's elements", () => {
    const code = readHostSessionScreenCode();
    for (const host of [
      "PiExtensionScreenHost",
      "PiExtensionSheetHost",
      "PiExtensionInlineStack",
    ]) {
      expect(code).toMatch(new RegExp(`<${host}[\\s\\S]*?elements=\\{piUiSession\\.elements\\}`));
    }
  });

  it("mounts the inline stack above the composer, not inside the transcript", () => {
    const code = readHostSessionScreenCode();
    const inlineIndex = code.indexOf("<PiExtensionInlineStack");
    const composerIndex = code.indexOf("<ComposerContainer");
    expect(inlineIndex).toBeGreaterThan(-1);
    expect(composerIndex).toBeGreaterThan(inlineIndex);
  });
});
