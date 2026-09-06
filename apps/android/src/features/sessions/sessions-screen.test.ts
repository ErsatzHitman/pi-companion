import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T32B1 source-level coverage for `sessions-screen.tsx`.
 *
 * `react-native` component modules can't be rendered under this
 * workspace's plain `vitest` setup (see `../extensions/renderers/
 * log-model.ts`'s note and `../../ui/primitives/touch-targets.test.ts`),
 * so — exactly like those files — this statically verifies the source
 * contracts a render/TalkBack pass would otherwise check. The rendering
 * *decisions* (status text, grouping, the combined accessibility label)
 * are real logic and are unit tested directly in `sessions-model.test.ts`.
 */
function readScreenSource(): string {
  return readFileSync(fileURLToPath(new URL("./sessions-screen.tsx", import.meta.url)), "utf8");
}

/**
 * `readScreenSource` with comments stripped (T32B2), matching
 * `../transcript/transcript-accessibility.test.ts`'s `readCode()`
 * precedent: this file's own doc comment quotes several of the JSX/prop
 * strings its assertions look for (e.g. `accessibilityRole="button"`),
 * so an unanchored regex over the raw file text can stay green after
 * the real construct is deleted. Assertions below that must reach
 * actual code read through this instead of `readScreenSource()`.
 */
function readScreenCode(): string {
  return readScreenSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("SessionsScreen source", () => {
  const code = readScreenCode();

  it("renders empty and error states from the shared PlaceholderState primitives, not hand-rolled", () => {
    expect(code).toMatch(
      /import\s*\{[^}]*\bEmptyState\b[^}]*\}\s*from\s*"\.\.\/\.\.\/ui\/primitives"/,
    );
    expect(code).toMatch(
      /import\s*\{[^}]*\bErrorState\b[^}]*\}\s*from\s*"\.\.\/\.\.\/ui\/primitives"/,
    );
    expect(code).toMatch(/<EmptyState\b/);
    expect(code).toMatch(/<ErrorState\b/);
  });

  it("declares a 48dp row touch target", () => {
    const minDimensions = [...code.matchAll(/minHeight:\s*(\d+)\b/g)].map((match) =>
      Number(match[1]),
    );
    expect(minDimensions.some((value) => value >= 48)).toBe(true);
  });

  it("marks each row as a single accessible node with a combined label, not colour alone", () => {
    // Comment-stripped (T130): this file's own module doc comment quotes
    // `accessible` verbatim ("every row is one `accessible` `Pressable`
    // node"), so an unanchored regex over raw file text is satisfied by
    // that prose alone and stays green even when the real prop is deleted.
    expect(code).toMatch(/accessible\b/);
    expect(code).toMatch(/accessibilityLabel=\{row\.accessibilityLabel\}/);
    // The status dot is decorative once the row carries the combined label; the status word itself stays visible text.
    expect(code).toMatch(/accessibilityElementsHidden/);
    expect(code).toMatch(/\{row\.statusText\}/);
  });

  it("reads its styling from useTheme() and contains no raw hex colour literal", () => {
    expect(code).toMatch(/useTheme\(\)/);
    // Comment-stripped: a doc comment mentioning a hex colour in prose
    // must never trip this — only a real colour literal in code should.
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("keeps SessionsScreenProps compatible with the route stub, which only ever passes serverId", () => {
    expect(code).toMatch(/serverId:\s*string/);
    expect(code).toMatch(/state\s*\?:\s*SessionListState/);
  });

  it("never constructs a connection: takes its data as a state prop rather than an owned data source", () => {
    // Comment-stripped: a doc comment could plausibly name `DaemonClient`
    // or `WebSocket` in prose (explaining why the screen doesn't own one)
    // without the real code ever constructing either.
    expect(code).not.toMatch(/new DaemonClient/);
    expect(code).not.toMatch(/new WebSocket/);
  });
});

describe("SessionsScreen source: T32B2 create/open wiring", () => {
  const code = readScreenCode();

  it("takes an optional injected SessionService rather than constructing a DaemonClient (plan.md §12.4)", () => {
    expect(code).toMatch(/sessionService\?:\s*SessionService/);
  });

  it("renders a create-session form driving SessionService.createSession through the model's begin/mark functions", () => {
    expect(code).toMatch(/beginCreateSession\(/);
    expect(code).toMatch(/sessionService\s*\.\s*createSession\(/);
    expect(code).toMatch(/markCreateSessionSucceeded\(/);
    expect(code).toMatch(/markCreateSessionFailed\(/);
  });

  it("each row is a Pressable that opens that session on tap, not a plain non-interactive View", () => {
    expect(code).toMatch(/<Pressable\b[\s\S]*?testID=\{testId\}/);
    expect(code).toMatch(/onPress=\{onOpen\}/);
    expect(code).toMatch(/beginSessionOpen\(/);
    expect(code).toMatch(/sessionService\s*\.\s*openSession\(/);
    expect(code).toMatch(/completeSessionOpen\(/);
    expect(code).toMatch(/failSessionOpen\(/);
  });

  it("surfaces an open failure as a visible Banner, not a silently-empty ready state", () => {
    expect(code).toMatch(/openState\.status === "error"/);
    expect(code).toMatch(/<Banner\b[\s\S]*?tone="danger"[\s\S]*?message=\{openState\.message\}/);
  });
});

describe("SessionsScreen source: T32B4 archive/delete wiring", () => {
  const code = readScreenCode();

  it("imports the shared Dialog primitive rather than hand-rolling a confirmation modal", () => {
    expect(code).toMatch(/import\s*\{[^}]*\bDialog\b[^}]*\}\s*from\s*"\.\.\/\.\.\/ui\/primitives"/);
  });

  it("renders one <Dialog> gated on a pending delete target, wired to confirm/dismiss", () => {
    expect(code).toMatch(
      /<Dialog\b[\s\S]*?open=\{actionsState\.deleteTarget !== null\}[\s\S]*?onConfirm=\{handleConfirmDelete\}[\s\S]*?onClose=\{handleDismissDelete\}/,
    );
  });

  it("dismissing the dialog goes through dismissDeleteRequest, never straight to SessionService.deleteSession", () => {
    expect(code).toMatch(
      /handleDismissDelete\s*=\s*useCallback\(\s*\(\)\s*=>\s*\{\s*setActionsState\(\(current\) => dismissDeleteRequest\(current\)\);/,
    );
  });

  it("confirming a delete goes through beginConfirmedDeleteSession before calling SessionService.deleteSession", () => {
    expect(code).toMatch(/beginConfirmedDeleteSession\(actionsStateRef\.current\)/);
    expect(code).toMatch(/sessionService\s*\.\s*deleteSession\(sessionId\)/);
  });

  it("removes the row only inside deleteSession's resolution handler, never before it settles", () => {
    const deleteCallIndex = code.indexOf("sessionService\n      .deleteSession(sessionId)");
    const thenIndex = code.indexOf(".then(() => {", deleteCallIndex);
    const removeIndex = code.indexOf("removeSessionFromList(", deleteCallIndex);
    expect(deleteCallIndex).toBeGreaterThan(-1);
    expect(thenIndex).toBeGreaterThan(deleteCallIndex);
    expect(removeIndex).toBeGreaterThan(thenIndex);
  });

  it("reconciles an archived row from what archiveSession resolved with (updated), not a local flip of archivedAt", () => {
    expect(code).toMatch(
      /sessionService\s*\.\s*archiveSession\(session\.id\)\s*\.then\(\(updated\) => \{\s*setListState\(\(current\) => reconcileSessionInList\(current, updated\)\);/,
    );
  });
});

describe("SessionsScreen source: T32B6 network sync / connection path / staleness wiring", () => {
  const code = readScreenCode();

  it("takes an optional network prop, independent of sessionService (plan.md §12.4's 'no client yet' seam)", () => {
    expect(code).toMatch(/network\?\s*:\s*NetworkReachability;/);
  });

  it("constructs SessionListNetworkSync only once both network and sessionService are present, wired to SessionService.refreshSessions and the live listState ref/setter — never a fake on the live path", () => {
    expect(code).toMatch(/if \(!network \|\| !sessionService\) return null;/);
    expect(code).toMatch(
      /new SessionListNetworkSync\(\{[\s\S]*?refreshSessions: \(\) => sessionService\.refreshSessions\(\)[\s\S]*?getState: \(\) => listStateRef\.current[\s\S]*?onStateChange: \(next\) => setListState\(next\)[\s\S]*?\}\)/,
    );
  });

  it("seeds the sync from network.getStatus() (subscribe alone only fires on a future change) then keeps it fed via network.subscribe", () => {
    expect(code).toMatch(
      /network\.getStatus\(\)\.then\(\(status\) => \{\s*if \(!cancelled\) sessionListNetworkSync\.handleNetworkStatus\(status\);/,
    );
    expect(code).toMatch(
      /network\.subscribe\(\(status\) => \{\s*sessionListNetworkSync\.handleNetworkStatus\(status\);/,
    );
  });

  it("renders the active connection path as visible text via sessionListConnectionPathLabel whenever the list is ready", () => {
    expect(code).toMatch(
      /listState\.kind === "ready" \? \(\s*<Banner\s+tone="neutral"\s+message=\{`Connection: \$\{sessionListConnectionPathLabel\(listState\.connectionPath\)\}`\}\s+testId=\{`\$\{testId\}-connection-path`\}/,
    );
  });

  it("feeds SessionListState.stale into describeSessionListStaleness through the explicit SessionListStalenessInput type, not a structurally-matching object literal", () => {
    expect(code).toMatch(
      /import\s*\{\s*describeSessionListStaleness,\s*type SessionListStalenessInput,\s*\}\s*from\s*"\.\.\/\.\.\/platform\/offline\/stale-announcement";/,
    );
    expect(code).toMatch(
      /const input: SessionListStalenessInput = \{\s*stale: listState\.kind === "ready" \? Boolean\(listState\.stale\) : false,\s*\};\s*return describeSessionListStaleness\(input\);/,
    );
  });

  it("renders T37B's staleness sentence as a warning Banner, text not colour alone, gated on listStaleness rather than a second boolean", () => {
    expect(code).toMatch(
      /\{listStaleness \? \([\s\S]*?<Banner tone="warning" message=\{listStaleness\.text\} testId=\{`\$\{testId\}-list-stale`\} \/>/,
    );
  });
});
