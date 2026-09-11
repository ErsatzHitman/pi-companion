import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `/h/:serverId/sessions` route stub coverage — T32S1C, given a real
 * `sessionService`/`keyValueStorage` by T32S3 (item 4). Source-level
 * contract test, same reason as `_layout.test.ts`: this module imports
 * `expo-router`.
 *
 * `readCode()` strips comments before matching — this file's own doc
 * comment names `sessionService`/`keyValueStorage`/`core.sessionService`,
 * so an unanchored match against the raw source would stay green even if
 * the real JSX props were deleted. See
 * `../../../../features/transcript/transcript-accessibility.test.ts`'s
 * doc comment for the concrete precedent this guards against.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./sessions.tsx", import.meta.url)), "utf8");
}

/**
 * Comment-stripped source, for the T32S13 (P5-W19) assertions below —
 * this file's own doc comment now names `core.sessionService.
 * refreshSessions()`/`applySessionListWindow` in prose, so an unanchored
 * match against the raw source (comments included) would stay green
 * even if the real fetch-on-mount effect were deleted. Same shape as
 * `../../../../features/transcript/transcript-accessibility.test.ts`'s
 * `readCode()`.
 */
function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("SessionsRoute source", () => {
  it("imports its screen from features/sessions rather than containing feature logic itself", () => {
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/features\/sessions"/);
    expect(readCode()).toMatch(/<SessionsScreen\b/);
  });

  it("reads serverId from the route params", () => {
    expect(readCode()).toMatch(/useLocalSearchParams/);
    expect(readCode()).toMatch(/serverId/);
  });

  it("passes a real sessionService and keyValueStorage from useAppCore(), not neither prop", () => {
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/core-context"/);
    expect(readCode()).toMatch(/const core = useAppCore\(\);/);
    expect(readCode()).toMatch(/sessionService=\{core\.sessionService\}/);
    expect(readCode()).toMatch(/keyValueStorage=\{core\.keyValueStorage\}/);
  });

  // T32S8, item 1: the one-liner T32B6 filed and T32S7 left unpicked —
  // `SessionsScreen`'s `network` prop (`sessions-screen.tsx`), which
  // constructs `SessionListNetworkSync`, was never passed by this route.
  it("also passes the real network adapter from useAppCore(), so SessionListNetworkSync is reachable in production", () => {
    expect(readCode()).toMatch(/network=\{core\.network\}/);
  });

  // T32S12 (P5-W18), T37E2's finding: a created session used to never
  // appear as a row because this route passed neither `state` nor
  // `onSessionCreated`.
  it("threads a local SessionListState through state/onSessionCreated so a created session appears as a row", () => {
    expect(readCode()).toMatch(/state=\{listState\}/);
    expect(readCode()).toMatch(/onSessionCreated=\{handleSessionCreated\}/);
    expect(readCode()).toMatch(
      /const \[listState, setListState\] = useState<SessionListState>\(INITIAL_SESSION_LIST_STATE\);/,
    );
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/app-shell\/session-list-append"/);
    expect(readCode()).toMatch(/appendCreatedSession\(current, session\)/);
  });

  // T336 (Maestro run 34462826449): this route used to omit
  // `onSessionOpened`, so a tapped row loaded the session and stayed on
  // the list -- nothing in the app navigated to
  // `/h/:serverId/session/:agentId` from a tap.
  it('T336: navigates to the opened session via router.push(destinationHref({ type: "session" })) on onSessionOpened', () => {
    expect(readCode()).toMatch(/import \{ useLocalSearchParams, useRouter \} from "expo-router";/);
    expect(readCode()).toMatch(
      /import \{ destinationHref \} from "\.\.\/\.\.\/\.\.\/\.\.\/app-shell\/top-level-destinations";/,
    );
    expect(readCode()).toMatch(/onSessionOpened=\{handleSessionOpened\}/);
    expect(readCode()).toMatch(
      /router\.push\(\s*destinationHref\(\{ type: "session", serverId: serverId \?\? "", agentId: result\.session\.id \}\),?\s*\);/,
    );
    // `push`, never `replace`: Android back from a session must return here.
    expect(readCode()).not.toMatch(/router\.replace\(/);
  });

  // T32S13 (P5-W19): this route used to never call
  // `sessionService.refreshSessions()` at all, so a returning user only
  // ever saw sessions created in this process.
  it("fetches the session list on mount via core.sessionService.refreshSessions(), folded through applySessionListWindow", () => {
    const code = readCode();
    expect(code).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/features\/sessions\/sessions-model\.js"/);
    expect(code).toMatch(
      /useEffect\(\(\) => \{\s*if \(phase !== \"connected\"\) return;\s*let cancelled = false;\s*core\.sessionService\s*\.refreshSessions\(\)\s*\.then\(\(window\) => \{\s*if \(cancelled\) return;\s*setListState\(\(current\) => applySessionListWindow\(current, window\)\);\s*\}\)/,
    );
    expect(code).toMatch(/}, \[core\.sessionService, phase\]\);/);
  });

  it("T337: reads the connection phase from useConnectionStatus(core.connection), fetches only while connected, and hands connected= to the screen so its restore waits too", () => {
    const code = readCode();
    expect(code).toMatch(
      /import \{ useConnectionStatus \} from "\.\.\/\.\.\/\.\.\/\.\.\/features\/connect";/,
    );
    expect(code).toMatch(/const \{ phase \} = useConnectionStatus\(core\.connection\);/);
    expect(code).toMatch(/connected=\{phase === "connected"\}/);
    // The old shape -- a fetch keyed on nothing but the service -- must be gone.
    expect(code).not.toMatch(/}, \[core\.sessionService\]\);/);
  });

  it("fences the fetch-on-mount effect with a cancelled flag so an abandoned fetch cannot clobber newer state", () => {
    const code = readCode();
    expect(code).toMatch(/return \(\) => \{\s*cancelled = true;\s*\};/);
  });
});

describe("sessions route: A1's close action (T362)", () => {
  it("passes onClose only when there is somewhere to close back to", () => {
    const code = readCode();
    expect(code).toMatch(/const canClose = router\.canGoBack\(\);/);
    expect(code).toMatch(/onClose=\{canClose \? handleClose : undefined\}/);
  });

  it("closes with back, never a replace onto another route", () => {
    // Reached from a session's own bar, closing must return to that
    // session, not push a new entry or swap this one out.
    const code = readCode();
    expect(code).toMatch(/const handleClose = useCallback\(\(\) => \{\s*router\.back\(\);/);
    expect(code).not.toMatch(/router\.replace\(/);
  });
});
