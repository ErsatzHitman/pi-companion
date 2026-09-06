import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import { matchDeepLinkPath } from "../../src/app-shell/deep-link-routing";
import {
  createDaemonTerminalBinaryTransport,
  type TerminalSessionCapableClient,
  type TerminalSessionHandleLike,
  type TerminalSessionWriteOutcome,
} from "../../src/app-shell/terminal-transport-adapter";
// Imported directly from their own files, never `../../src/features/terminal`'s
// barrel: that barrel also re-exports `terminal-screen.tsx` and
// `terminal-webview-port.ts`'s `TerminalWebViewPort` *type*, but
// `terminal-screen.tsx` itself reaches `react-native` (`StyleSheet`,
// `View`), which this workspace's vitest cannot parse (`CLAUDE.md`'s
// "RN-in-vitest limitation"). `terminal-session-controller.ts` and
// `terminal-webview-port.ts` are both RN-free by construction — see
// each file's own `grep -n react-native` (comment mentions only, no
// import) — so importing them by their own path avoids ever loading the
// barrel that would pull the RN-reaching sibling in.
import { TerminalSessionController } from "../../src/features/terminal/terminal-session-controller";
import { createUnavailableTerminalWebViewPort } from "../../src/features/terminal/terminal-webview-port";
import { FILES_TERMINAL_FLOW } from "./files-and-terminal-contract";
import { PRODUCTION_DAEMON_PORT } from "../harness/production-daemon-port";
import { parseMaestroSteps } from "./maestro-yaml";

/**
 * T37E9 — proves every testId/deep-link/string
 * `../../maestro/files-and-terminal.yaml` names still exists in the real
 * source it targets, and separately proves the one behavior this flow's
 * own brief calls out by name and Maestro itself cannot observe from
 * outside the app: that leaving the terminal route genuinely tears the
 * daemon-side terminal session down, through the REAL
 * `createDaemonTerminalBinaryTransport` (T65's dispose fix, applied at
 * the P5-W19 merge gate) and the REAL `TerminalSessionController`
 * together — never a fake standing in for either half of that cascade
 * (`terminal-session-controller.test.ts` already proves the controller
 * reaches a *fake* transport's `dispose()`; `terminal-transport-
 * adapter.test.ts` already proves the *real* adapter's `dispose()`
 * against a *fake* daemon client in isolation — neither proves the two
 * wired together the way `terminal-screen.tsx`'s own unmount effect
 * actually wires them. That crossing is this file's own contribution).
 *
 * Two proof strategies, chosen per module, matching every sibling
 * `*.contract.test.ts` in this directory:
 *
 * - `deep-link-routing.ts`, `terminal-session-controller.ts`, and
 *   `terminal-transport-adapter.ts` are RN-free, so this file imports
 *   them directly and calls the real functions/classes — stronger than
 *   a source-text match.
 * - `files-screen.tsx`, `terminal-screen.tsx`, and both route files
 *   under `app/h/[serverId]/session/[agentId]/` reach `react-native`
 *   (directly or, for the route files, indirectly through the screens
 *   they render) and cannot be imported here, so those are proven with
 *   `readCode()`/`readComponentCode()` — comment-stripped source
 *   matched against a full JSX/statement expression, never a bare
 *   identifier (this workspace's catalogued source-text defect
 *   classes), anchored to the one top-level function/component each
 *   assertion names where the file declares more than one.
 *
 * Mutation-checked (see this task's report for the exact mutations,
 * their failures, and the byte-identical restores): the files-screen
 * upload-visible yaml assertion (flipping it back to `assertNotVisible`,
 * reproducing the exact bug T86 fixes), the route's real-filePicker
 * assertion (deleting `filePicker={core.filePicker}` from the route),
 * the terminal route's real-webview assertion (deleting
 * `webview={core.terminalWebview}` from the route — T80, see below), and
 * the dispose-cascade integration test (deleting
 * `this.transport.dispose?.()` from `terminal-session-controller.ts`).
 *
 * T80 (P5-W23) — CORRECTED a stale claim this paragraph used to make: it
 * described the terminal-route assertion below as pinning a *missing*
 * `webview` prop shut (`.not.toMatch(/webview=/)`, "reproduced by adding
 * a `webview=` prop"). T80 wired that prop — the route now passes
 * `webview={core.terminalWebview}`, the same "read the field straight off
 * `AppCore`" shape `transport` already used — so that negative assertion
 * would now fail on the app's own correct, shipped source. It is replaced
 * by a positive assertion that both props actually reach `TerminalScreen`
 * (see the terminal-route describe block below), plus a new
 * `app-shell/core.ts` assertion that `AppCore.terminalWebview` is
 * constructed from the real `createUnavailableTerminalWebViewPort()`, not
 * omitted or faked. The *visible outcome* this flow asserts is unchanged:
 * `core.terminalWebview.isAvailable` is still `false` (no
 * `react-native-webview` install exists in this workspace), so
 * `TerminalScreen` still takes its "unavailable" branch — only the reason
 * changed, from "no prop wired at all" to "a real, honestly-unavailable
 * port is wired".
 *
 * T86 — until this task, nothing in this directory ever parsed
 * `../../maestro/files-and-terminal.yaml`'s own steps (`grep -rn
 * "agent-upload" e2e src` returned nothing outside this comment's own
 * history); every assertion above only checked that source still
 * matched this file's own hand-typed retelling of the yaml. That is
 * exactly how the yaml came to carry `assertNotVisible` on the upload
 * panel's testId for one whole wave after T78 mounted the `filePicker`
 * that makes it render — a bug only a human reading the yaml at the
 * merge gate caught, and this file's own tests stayed green throughout.
 * The "`files-and-terminal.yaml` itself, read from disk" describe block
 * below closes that gap using T72's `parseMaestroSteps`
 * (`./maestro-yaml.ts`), the same way `file-download.contract.test.ts`
 * already does for its own flow: it reads the yaml's real bytes, parses
 * every step, and cross-checks every `id:`/`text:`/`openLink` value
 * against `FILES_TERMINAL_FLOW`'s real-source-derived constants — never
 * only against this file's own retelling.
 *
 * The second, related fix: the "uploadController is null whenever
 * filePicker is missing" test used to match `FilesScreen`'s own internal
 * guard (`if (!client || !filePicker) return null;`) verbatim — a
 * predicate that can never fail no matter what any real route passes,
 * because the guard's source text sits right there in this test file
 * regardless of the wiring outside it (this workspace's "a check that
 * only matches a guard's SOURCE SHAPE is hollow" defect class). That
 * assertion is replaced below with one that reads the ROUTE's actual
 * JSX props (`filePicker={core.filePicker}`), which — since
 * `AppCore.filePicker`/`AppCore.fileBrowserClient` are both typed
 * non-optional in `core.ts`, never `| undefined` — is what actually,
 * unconditionally makes `uploadController` non-null at runtime.
 */

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * `readCode(relativePath)` sliced to a single top-level function's body
 * (`(?:export )?function <name>(` through the next top-level
 * `function `/`export default function ` or end of file) — matches
 * `extension-sheets.contract.test.ts`'s `readComponentCode` exactly,
 * for the same "a file with more than one top-level function makes an
 * unanchored match untrustworthy" reason.
 */
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

/** Matches `file-download.contract.test.ts`'s own `FILES_ROUTE_TSX` naming for the same route file. */
const FILES_ROUTE_TSX = "../../src/app/h/[serverId]/session/[agentId]/files/[...path].tsx";

describe("files-and-terminal.yaml anchors exist in source", () => {
  describe("files-screen.tsx", () => {
    it("FilesScreen's root testId is built as `files-screen-${serverId}-${agentId}`", () => {
      const code = readComponentCode("../../src/features/files/files-screen.tsx", "FilesScreen");
      expect(code).toMatch(/const testId = `files-screen-\$\{serverId\}-\$\{agentId\}`;/);
      expect(code).toMatch(/<ScrollView style=\{styles\.container\} testID=\{testId\}>/);
    });

    it("the breadcrumbs row carries testId={`${testId}-breadcrumbs`}", () => {
      const code = readComponentCode("../../src/features/files/files-screen.tsx", "FilesScreen");
      expect(code).toMatch(/testId=\{`\$\{testId\}-breadcrumbs`\}/);
    });

    it("the not-connected ErrorState renders only when `!client || workspaceRoot === undefined`, with testId={`${testId}-not-connected`}", () => {
      const code = readComponentCode("../../src/features/files/files-screen.tsx", "FilesScreen");
      expect(code).toMatch(
        /!client \|\| workspaceRoot === undefined \? \(\s*<ErrorState\s+title="Not connected"\s+description="Connect to a daemon to browse files for this session\."\s+testId=\{`\$\{testId\}-not-connected`\}/,
      );
    });

    it("UploadPanel only renders when uploadController is non-null, and the WIRED ROUTE — not files-screen.tsx's own internal guard shape — is what actually, unconditionally supplies the filePicker that makes it non-null", () => {
      // Half one: still an honest fact about FilesScreen's own render
      // logic — UploadPanel only mounts once uploadController is
      // truthy.
      const screenCode = readComponentCode(
        "../../src/features/files/files-screen.tsx",
        "FilesScreen",
      );
      expect(screenCode).toMatch(
        /\{uploadController \? \(\s*<UploadPanel\s+controller=\{uploadController\}\s+state=\{uploadState\}\s+theme=\{theme\}\s+testId=\{`\$\{testId\}-upload`\}/,
      );

      // Half two — the one T86 replaces. The old predicate here matched
      // `if (!client || !filePicker) return null;` verbatim: that text
      // is FilesScreen's OWN source, quoted by this very test file, so
      // it can never fail regardless of what any real route passes in —
      // deleting `!filePicker` from the guard breaks the OLD assertion,
      // but nothing a route does could ever break it, which is exactly
      // the hollowness T86 files. Read the ROUTE that is actually wired
      // into the running app instead: if it ever stopped passing a real
      // filePicker, THIS is the assertion that would catch it.
      const routeCode = readCode(FILES_ROUTE_TSX);
      expect(routeCode).toMatch(
        /<FilesScreen[\s\S]*?client=\{core\.fileBrowserClient\}[\s\S]*?filePicker=\{core\.filePicker\}[\s\S]*?\/>/,
      );

      // And that prop is never optional at its source: AppCore's own
      // fields are typed `FileBrowserClient`/`FilePicker`, never
      // `| undefined`, so the route above can never pass `undefined`
      // even conditionally — this is what makes the JSX match above a
      // genuine, unconditional guarantee rather than one more piece of
      // text this file happens to also contain.
      const coreCode = readCode("../../src/app-shell/core.ts");
      expect(coreCode).toMatch(/fileBrowserClient: FileBrowserClient;/);
      expect(coreCode).toMatch(/filePicker: FilePicker;/);
    });
  });

  describe("app/h/[serverId]/session/[agentId]/files/[...path].tsx (the files route)", () => {
    // T78 (P5-W22): `filePicker`/`sharing` are now real, wired props —
    // `AppCore.filePicker`/`AppCore.sharing` — so the negative
    // `.not.toMatch(/filePicker=/)`/`.not.toMatch(/sharing=/)` assertions
    // this test used to carry (pinning the P5-W20-era "still not wired"
    // gap shut) are removed per "never write a negative assertion that
    // pins an unfinished thing shut" once the thing stops being
    // unfinished; the positive regex below now includes both lines
    // instead.
    it("passes FilesScreen a real client (core.fileBrowserClient), a real fetchImpl, and — since T78 (P5-W22) — a real filePicker/sharing from AppCore, never omitted or locally constructed", () => {
      const code = readCode("../../src/app/h/[serverId]/session/[agentId]/files/[...path].tsx");
      expect(code).toMatch(
        /<FilesScreen\s*\n\s*serverId=\{serverId\}\s*\n\s*agentId=\{agentId\}\s*\n\s*path=\{path \?\? \[\]\}\s*\n\s*workspaceRoot=""\s*\n\s*client=\{core\.fileBrowserClient\}\s*\n\s*filePicker=\{core\.filePicker\}\s*\n\s*sharing=\{core\.sharing\}\s*\n\s*downloadOrigin=\{downloadOrigin\}\s*\n\s*connectionPath=\{connectionPath\}\s*\n\s*fetchImpl=\{fetchImpl\}\s*\n\s*\/>/,
      );
    });
  });

  describe("app-shell/deep-link-routing.ts", () => {
    it("matchDeepLinkPath classifies h/<serverId>/session/<agentId>/files as sessionFiles", () => {
      const code = readComponentCode(
        "../../src/app-shell/deep-link-routing.ts",
        "matchDeepLinkPath",
      );
      expect(code).toMatch(
        /if \(tail\[0\] === "files"\) \{\s*return \{ kind: "sessionFiles", serverId, agentId, path: tail\.slice\(1\) \};/,
      );
    });

    it("matchDeepLinkPath classifies h/<serverId>/session/<agentId>/terminal/<terminalId> as sessionTerminal", () => {
      const code = readComponentCode(
        "../../src/app-shell/deep-link-routing.ts",
        "matchDeepLinkPath",
      );
      expect(code).toMatch(
        /if \(tail\.length === 2 && tail\[0\] === "terminal"\) \{\s*return \{ kind: "sessionTerminal", serverId, agentId, terminalId: tail\[1\] \};/,
      );
    });

    it("real matchDeepLinkPath() resolves both of this flow's own deep links to the expected match, not just a regex on the source", () => {
      const filesMatch = matchDeepLinkPath(
        `/h/${FILES_TERMINAL_FLOW.serverId}/session/${FILES_TERMINAL_FLOW.filesAgentId}/files`,
      );
      expect(filesMatch).toEqual({
        kind: "sessionFiles",
        serverId: FILES_TERMINAL_FLOW.serverId,
        agentId: FILES_TERMINAL_FLOW.filesAgentId,
        path: [],
      });

      const terminalMatch = matchDeepLinkPath(
        `/h/${FILES_TERMINAL_FLOW.serverId}/session/${FILES_TERMINAL_FLOW.terminalAgentId}/terminal/${FILES_TERMINAL_FLOW.terminalId}`,
      );
      expect(terminalMatch).toEqual({
        kind: "sessionTerminal",
        serverId: FILES_TERMINAL_FLOW.serverId,
        agentId: FILES_TERMINAL_FLOW.terminalAgentId,
        terminalId: FILES_TERMINAL_FLOW.terminalId,
      });
    });

    it("FILES_TERMINAL_FLOW's deep-link builders agree with the literal URLs the yaml opens", () => {
      expect(
        FILES_TERMINAL_FLOW.filesDeepLink(
          FILES_TERMINAL_FLOW.serverId,
          FILES_TERMINAL_FLOW.filesAgentId,
        ),
      ).toBe("picompanion://h/e2e-host/session/e2e-files-agent/files");
      expect(
        FILES_TERMINAL_FLOW.terminalDeepLink(
          FILES_TERMINAL_FLOW.serverId,
          FILES_TERMINAL_FLOW.terminalAgentId,
          FILES_TERMINAL_FLOW.terminalId,
        ),
      ).toBe("picompanion://h/e2e-host/session/e2e-terminal-agent/terminal/e2e-terminal-1");
      expect(
        FILES_TERMINAL_FLOW.filesTestId(
          FILES_TERMINAL_FLOW.serverId,
          FILES_TERMINAL_FLOW.filesAgentId,
        ),
      ).toBe("files-screen-e2e-host-e2e-files-agent");
    });
  });

  describe("terminal-screen.tsx", () => {
    it('both the "unavailable" and live branches carry the outer container testID="terminal-screen"', () => {
      const code = readComponentCode(
        "../../src/features/terminal/terminal-screen.tsx",
        "TerminalScreen",
      );
      const occurrences = code.match(/testID="terminal-screen"/g) ?? [];
      expect(occurrences.length).toBe(2);
    });

    it('the "unavailable" branch (taken whenever !resolvedWebview.isAvailable — always true with no react-native-webview installed) renders EmptyState with the exact title/description/testId this flow asserts', () => {
      const code = readComponentCode(
        "../../src/features/terminal/terminal-screen.tsx",
        "TerminalScreen",
      );
      expect(code).toMatch(
        /if \(!resolvedWebview\.isAvailable\) \{\s*return \(\s*<View style=\{styles\.container\} testID="terminal-screen">\s*<EmptyState\s+title="Terminal unavailable"\s+description="This build has no embedded terminal renderer installed yet\. Your session and its output are unaffected\."\s+testId="terminal-unavailable"/,
      );
    });

    it("the unmount cleanup calls controller.setVisible(false) then controller.dispose(), exactly the sequence this flow's leave-the-route step exercises", () => {
      const code = readComponentCode(
        "../../src/features/terminal/terminal-screen.tsx",
        "TerminalScreen",
      );
      expect(code).toMatch(
        /return \(\) => \{\s*controller\.setVisible\(false\);\s*controller\.dispose\(\);\s*controllerRef\.current = null;\s*\};/,
      );
    });
  });

  describe("app/h/[serverId]/session/[agentId]/terminal/[terminalId].tsx (the terminal route)", () => {
    // T80 (P5-W23): this route used to pass no `webview` prop at all —
    // the negative `.not.toMatch(/webview=/)` assertion this test used to
    // carry (pinning that gap shut) is removed per "never write a
    // negative assertion that pins an unfinished thing shut" once the
    // thing stops being unfinished; the positive regex below now
    // includes that line instead. The visible outcome is UNCHANGED:
    // `core.terminalWebview` (`app-shell/core.ts`) is still
    // `createUnavailableTerminalWebViewPort()` — no `react-native-webview`
    // install exists in this workspace — so `TerminalScreen` still takes
    // its "unavailable" branch. This test now proves a real value
    // actually reaches the prop, not merely that the field exists
    // somewhere on `AppCore` (see the `app-shell/core.ts` describe block
    // below for that half).
    it("passes TerminalScreen a real transport (core.createTerminalTransport) AND a real webview (core.terminalWebview), never omitted", () => {
      const code = readCode(
        "../../src/app/h/[serverId]/session/[agentId]/terminal/[terminalId].tsx",
      );
      expect(code).toMatch(
        /const transport = useMemo\(\s*\(\) => core\.createTerminalTransport\(terminalId \?\? "", 0\),\s*\[core, terminalId\],\s*\);/,
      );
      expect(code).toMatch(
        /<TerminalScreen\s*\n\s*serverId=\{serverId\}\s*\n\s*agentId=\{agentId\}\s*\n\s*terminalId=\{terminalId\}\s*\n\s*transport=\{transport\}\s*\n\s*webview=\{core\.terminalWebview\}\s*\n\s*\/>/,
      );
    });
  });

  describe("terminal-session-controller.ts", () => {
    it("dispose() cascades into the transport's own optional dispose() — the T65 half of the teardown chain", () => {
      const code = readCode("../../src/features/terminal/terminal-session-controller.ts");
      expect(code).toMatch(
        /dispose\(\): void \{\s*for \(const unsubscribe of this\.unsubscribers\) \{\s*unsubscribe\(\);\s*\}\s*this\.resize\.dispose\(\);\s*this\.webview\.dispose\(\);\s*this\.transport\.dispose\?\.\(\);\s*\}/,
      );
    });
  });

  describe("app-shell/core.ts", () => {
    it("AppCore.createTerminalTransport is wired to the real createDaemonTerminalBinaryTransport, reading the live connection fresh, never a stub", () => {
      const code = readCode("../../src/app-shell/core.ts");
      expect(code).toMatch(
        /createTerminalTransport: \(terminalId, slot\) =>\s*createDaemonTerminalBinaryTransport\(\{\s*terminalId,\s*slot,\s*getClient: \(\) =>\s*\(connection\s*\.getActiveLifecycle\(\)\s*\?\.getDaemonClient\(\) as unknown as TerminalSessionCapableClient \| null\) \?\? null,\s*subscribeConnectionChanges: \(listener\) => connection\.subscribe\(listener\),\s*\}\),/,
      );
    });

    // T80 (P5-W23): AppCore.terminalWebview is what the terminal route
    // above actually reads (`webview={core.terminalWebview}`) — this
    // proves the field is constructed from the real, honest factory, not
    // omitted, `undefined`, or a locally-faked object that would make the
    // route-level regex above pass without a real value existing on
    // AppCore at all.
    it("AppCore.terminalWebview is constructed from the real createUnavailableTerminalWebViewPort(), and returned from createAppCore()", () => {
      const code = readCode("../../src/app-shell/core.ts");
      expect(code).toMatch(/const terminalWebview = createUnavailableTerminalWebViewPort\(\);/);
      expect(code).toMatch(/return \{[\s\S]*?\bterminalWebview,[\s\S]*?\};/);
    });
  });
});

// ---------------------------------------------------------------------------
// T86 — files-and-terminal.yaml itself, read from disk. Everything above
// only proves real source matches this file's own hand-typed
// `FILES_TERMINAL_FLOW` restatement of the yaml; nothing above ever opens
// `../../maestro/files-and-terminal.yaml` itself. That is exactly the gap
// that let it carry `assertNotVisible` on the upload panel's testId for a
// whole wave after T78 mounted the `filePicker` that makes it render (see
// this file's header comment). This block closes that gap by parsing the
// yaml's actual steps (T72's `parseMaestroSteps`, `./maestro-yaml.ts`) and
// checking them against the same real, source-derived values the rest of
// this file already proves are honest — matching
// `file-download.contract.test.ts`'s own precedent for this directory.
// ---------------------------------------------------------------------------
describe("files-and-terminal.yaml itself, read from disk", () => {
  const FILES_AND_TERMINAL_YAML = "../../maestro/files-and-terminal.yaml";
  const yamlText = readSource(FILES_AND_TERMINAL_YAML);
  const steps = parseMaestroSteps(yamlText);
  const filesTestId = FILES_TERMINAL_FLOW.filesTestId(
    FILES_TERMINAL_FLOW.serverId,
    FILES_TERMINAL_FLOW.filesAgentId,
  );

  it("opens exactly the two deep links FILES_TERMINAL_FLOW's builders build, in order (files, then terminal)", () => {
    const openLinks = steps.filter((step) => step.kind === "openLink").map((step) => step.value);
    expect(openLinks).toEqual([
      FILES_TERMINAL_FLOW.filesDeepLink(
        FILES_TERMINAL_FLOW.serverId,
        FILES_TERMINAL_FLOW.filesAgentId,
      ),
      FILES_TERMINAL_FLOW.terminalDeepLink(
        FILES_TERMINAL_FLOW.serverId,
        FILES_TERMINAL_FLOW.terminalAgentId,
        FILES_TERMINAL_FLOW.terminalId,
      ),
    ]);
  });

  it("asserts the real files-screen root and breadcrumbs ids visible, and the not-connected id absent (a real connection was paired first)", () => {
    const visibleIds = steps
      .filter((step) => step.kind === "assertVisible" && step.id !== undefined)
      .map((step) => step.id as string);
    const notVisibleIds = steps
      .filter((step) => step.kind === "assertNotVisible" && step.id !== undefined)
      .map((step) => step.id as string);

    expect(visibleIds).toContain(filesTestId);
    expect(visibleIds).toContain(FILES_TERMINAL_FLOW.filesBreadcrumbsTestId(filesTestId));
    expect(notVisibleIds).toContain(FILES_TERMINAL_FLOW.filesNotConnectedTestId(filesTestId));
  });

  it(
    "asserts the upload panel's testId VISIBLE, never NotVisible — the exact regression this task fixes " +
      "(T78 mounted a real filePicker; a stale assertNotVisible here is precisely the bug T86 files)",
    () => {
      const visibleIds = steps
        .filter((step) => step.kind === "assertVisible" && step.id !== undefined)
        .map((step) => step.id as string);
      const notVisibleIds = steps
        .filter((step) => step.kind === "assertNotVisible" && step.id !== undefined)
        .map((step) => step.id as string);
      const uploadTestId = FILES_TERMINAL_FLOW.filesUploadTestId(filesTestId);

      expect(
        visibleIds,
        `files-and-terminal.yaml should assertVisible id="${uploadTestId}" — UploadPanel renders now that ` +
          "the route supplies a real filePicker (T78)",
      ).toContain(uploadTestId);
      expect(
        notVisibleIds,
        `files-and-terminal.yaml must NOT assertNotVisible id="${uploadTestId}" — that premise was destroyed by T78`,
      ).not.toContain(uploadTestId);
    },
  );

  it("asserts the real terminal-screen and terminal-unavailable ids visible, and terminal-screen absent again after leaving the route", () => {
    const visibleIds = steps
      .filter((step) => step.kind === "assertVisible" && step.id !== undefined)
      .map((step) => step.id as string);
    const notVisibleIds = steps
      .filter((step) => step.kind === "assertNotVisible" && step.id !== undefined)
      .map((step) => step.id as string);

    expect(visibleIds).toContain(FILES_TERMINAL_FLOW.terminalScreenTestId);
    expect(visibleIds).toContain(FILES_TERMINAL_FLOW.terminalUnavailableTestId);
    expect(notVisibleIds).toContain(FILES_TERMINAL_FLOW.terminalScreenTestId);
  });

  it("asserts terminal-unavailable's real title/description and the real direct-connection status text", () => {
    const visibleTexts = steps
      .filter((step) => step.kind === "assertVisible" && step.text !== undefined)
      .map((step) => step.text as string);

    expect(visibleTexts).toContain(FILES_TERMINAL_FLOW.terminalUnavailableTitle);
    expect(visibleTexts).toContain(FILES_TERMINAL_FLOW.terminalUnavailableDescription);
    expect(visibleTexts).toContain(FILES_TERMINAL_FLOW.connectedDirectStatusText);
  });

  it("every id: selector this flow names resolves to a real testId this file already pinned against source", () => {
    // The complete set of ids this yaml's own steps use, cross-checked
    // against `FILES_TERMINAL_FLOW`'s constants — which the describe
    // blocks above already prove match real, live source (files-screen,
    // terminal-screen, and both route files). Excludes the shared
    // onboarding/connect-form ids (`connect-onboarding*`, `connect-form*`)
    // this flow's pairing block reuses verbatim from `pairing.yaml`,
    // matching `file-download.contract.test.ts`'s own scope: those ids
    // are `pairing.contract.test.ts`'s (T37E1's) to keep honest, not this
    // file's — this file owns `files-and-terminal.yaml` only.
    const knownIds = new Set([
      filesTestId,
      FILES_TERMINAL_FLOW.filesBreadcrumbsTestId(filesTestId),
      FILES_TERMINAL_FLOW.filesNotConnectedTestId(filesTestId),
      FILES_TERMINAL_FLOW.filesUploadTestId(filesTestId),
      FILES_TERMINAL_FLOW.terminalScreenTestId,
      FILES_TERMINAL_FLOW.terminalUnavailableTestId,
      FILES_TERMINAL_FLOW.connectFormSection,
      FILES_TERMINAL_FLOW.connectFormAddressField,
      FILES_TERMINAL_FLOW.connectFormSubmitButton,
      "connect-onboarding",
      "connect-onboarding-welcome-continue",
      "connect-onboarding-permission-continue",
    ]);
    const idsInYaml = steps
      .filter((step) => step.id !== undefined)
      .map((step) => ({ line: step.line, id: step.id as string }));
    expect(idsInYaml.length).toBeGreaterThan(0);
    for (const { line, id } of idsInYaml) {
      expect(
        knownIds.has(id),
        `files-and-terminal.yaml:${line} names unrecognised id "${id}"`,
      ).toBe(true);
    }
  });

  it("never names the production daemon's port, in any form including comments", () => {
    expect(
      yamlText.includes(String(PRODUCTION_DAEMON_PORT)),
      `files-and-terminal.yaml must never name the production daemon port ${PRODUCTION_DAEMON_PORT}, in any form`,
    ).toBe(false);
  });
});

/** Deterministic, manually-advanced `Clock` test double — same shape `terminal-session-controller.test.ts`'s own `FakeClock` already uses. */
class FakeClock implements Clock {
  private currentTime = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { dueAt: number; callback: () => void }>();

  now(): number {
    return this.currentTime;
  }
  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { dueAt: this.currentTime + delayMs, callback });
    return id as unknown as TimerHandle;
  }
  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }
  setInterval(): TimerHandle {
    throw new Error("not used");
  }
  clearInterval(): void {
    // not used
  }
}

/** Scripted fake of T62's `TerminalSessionHandleLike` — tracks exactly what a real daemon-side session would receive/report. */
class FakeTerminalSession implements TerminalSessionHandleLike {
  state: "open" | "closed" = "open";
  closeCalls = 0;
  private readonly closedHandlers = new Set<() => void>();

  writeInput(): TerminalSessionWriteOutcome {
    return this.state === "closed" ? "dropped-closed" : "sent";
  }
  resize(): TerminalSessionWriteOutcome {
    return this.state === "closed" ? "dropped-closed" : "sent";
  }
  onOutput(): () => void {
    return () => undefined;
  }
  onSnapshot(): () => void {
    return () => undefined;
  }
  onRestore(): () => void {
    return () => undefined;
  }
  onClosed(handler: () => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }
  close(): void {
    this.closeCalls += 1;
    this.state = "closed";
    for (const handler of this.closedHandlers) handler();
  }
}

describe("leaving the terminal route genuinely tears the session down (real adapter + real controller, no fakes standing in for either)", () => {
  it("controller.dispose() (the exact call terminal-screen.tsx's unmount cleanup makes) closes the real daemon-side session exactly once, reports the transport closed, unsubscribes from reconnects, and a second dispose is a safe no-op", async () => {
    const session = new FakeTerminalSession();
    const client: TerminalSessionCapableClient = {
      openTerminalSession: () => Promise.resolve(session),
    };
    let subscriber: (() => void) | null = null;

    const transport = createDaemonTerminalBinaryTransport({
      terminalId: FILES_TERMINAL_FLOW.terminalId,
      slot: 0,
      getClient: () => client,
      subscribeConnectionChanges: (listener) => {
        subscriber = listener;
        return () => {
          subscriber = null;
        };
      },
    });

    // Flush the constructor's own `openTerminalSession().then(...)` microtask.
    await Promise.resolve();
    await Promise.resolve();
    expect(transport.isOpen).toBe(true);
    expect(subscriber).not.toBeNull();

    // Exactly what TerminalScreen's mount effect builds:
    const controller = new TerminalSessionController({
      transport,
      webview: createUnavailableTerminalWebViewPort(),
      slot: 0,
      clock: new FakeClock(),
    });
    controller.setVisible(true);

    // Exactly what TerminalScreen's unmount cleanup calls (pinned above
    // by source-text — this is the same sequence proven live):
    controller.setVisible(false);
    controller.dispose();

    expect(session.closeCalls).toBe(1);
    expect(transport.isOpen).toBe(false);
    // Unsubscribed from connection-change publishes — a stale reconnect
    // notification after this point has nothing left to call.
    expect(subscriber).toBeNull();

    // Idempotent per T65's contract: calling the transport's own
    // dispose() again (as would happen if something called it twice)
    // reports already-disposed and never double-closes the session.
    // (`terminal-transport-adapter.test.ts` already proves the
    // never-connected / late-resolving-session-closed-not-adopted cases
    // for this same adapter in isolation — not repeated here, since this
    // file's own job is the controller+adapter crossing above, not a
    // second copy of that file's own coverage.)
    expect(transport.dispose?.()).toBe("already-disposed");
    expect(session.closeCalls).toBe(1);
  });
});
