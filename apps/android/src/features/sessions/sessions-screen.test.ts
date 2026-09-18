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
    // Named constants are resolved the same way `touch-targets.test.ts`
    // resolves them, so a row shrunk through `ROW_MIN_HEIGHT` still fails
    // here rather than reading as "no declared minimum".
    const constants = new Map(
      [...code.matchAll(/const ([A-Za-z_$][\w$]*) = (\d+);/g)].map(([, name, value]) => [
        name,
        Number(value),
      ]),
    );
    const minDimensions = [...code.matchAll(/minHeight:\s*(\d+|[A-Za-z_$][\w$]*)/g)].map(
      ([, token]) => (constants.has(token) ? constants.get(token) : Number(token)),
    );
    expect(minDimensions.some((value) => value !== undefined && value >= 48)).toBe(true);
  });

  it("marks each row as a single accessible node with a combined label, not colour alone", () => {
    // Comment-stripped (T130): this file's own module doc comment quotes
    // `accessible` verbatim ("every row is one `accessible` `Pressable`
    // node"), so an unanchored regex over raw file text is satisfied by
    // that prose alone and stays green even when the real prop is deleted.
    expect(code).toMatch(/accessible\b/);
    // CORRECTED (T363): this read `accessibilityLabel={row.accessibilityLabel}`.
    // The label is still the model's, and still combined — T363 only
    // works the row's age into it, which the model also owns
    // (`sessionRowAccessibilityLabelWithAge`). Re-anchored at the new
    // call rather than loosened to `accessibilityLabel=` alone, which
    // would pass against a hand-assembled label built in the JSX.
    expect(code).toMatch(/accessibilityLabel=\{sessionRowAccessibilityLabelWithAge\(row, age\)\}/);
    // CORRECTED (T363): this read `accessibilityElementsHidden` and
    // `{row.statusText}`. Both pinned the same claim — the state is
    // spoken and printed, never colour alone — against a hand-drawn dot
    // beside a caption. That drawing is gone: the status is now a
    // `StatusPill`, which prints the word itself and owns its own dot,
    // and the row's `accessible` wrapper above collapses the whole
    // thing into one TalkBack stop. The claim is unchanged and is
    // re-anchored at the pill; it is not dropped, which would have left
    // nothing asserting the word is drawn at all.
    expect(code).toMatch(/<StatusPill\s+label=\{row\.statusText\}/);
    expect(code).toMatch(/tone=\{row\.tone\}/);
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

  it("T329: the screen's ScrollView delivers a tap that follows typing to the create form's submit, not to dismissing the keyboard", () => {
    expect(readScreenCode()).toMatch(/<ScrollView[^>]*keyboardShouldPersistTaps="handled"/);
  });

  it("T330: shrinks the ScrollView viewport by the live keyboard inset", () => {
    expect(readScreenCode()).toMatch(/const keyboardInset = useKeyboardInset\(\);/);
    expect(readScreenCode()).toMatch(
      /<ScrollView[^>]*style=\{\[styles\.container, \{ marginBottom: keyboardInset \}\]\}/,
    );
  });

  it("renders T37B's staleness sentence as a warning Banner, text not colour alone, gated on listStaleness rather than a second boolean", () => {
    expect(code).toMatch(
      /\{listStaleness \? \([\s\S]*?<Banner tone="warning" message=\{listStaleness\.text\} testId=\{`\$\{testId\}-list-stale`\} \/>/,
    );
  });
});

describe("SessionsScreen source: T337 the cold-start restore waits for the connection", () => {
  const code = readScreenSource();

  it("takes an optional connected prop, absent meaning the pre-T337 'assume connected' behaviour", () => {
    expect(code).toMatch(/connected\?: boolean;/);
    // CORRECTED (T362): the anchor was `connected,\s*\}` — T362 added
    // `onClose` after it, so the prop is no longer last in the
    // destructuring. Re-anchored at its new address rather than
    // loosened to `connected,` alone, which would also pass against a
    // `connected` that had been dropped from the signature entirely.
    // CORRECTED again (T364): `onOpenSettings` now follows `onClose`.
    // Re-anchored rather than loosened for the reason T362 gave.
    expect(code).toMatch(
      /onSessionOpened,\s*connected,\s*onClose,\s*onOpenSettings,\s*\}: SessionsScreenProps\)/,
    );
  });

  it("the restore effect returns early while connected === false and re-runs when it flips (connected is in its deps)", () => {
    const effect = code.slice(
      code.indexOf("if (!sessionService || !keyValueStorage) return;"),
      code.indexOf("}, [sessionService, keyValueStorage, connected]);"),
    );
    expect(effect.length).toBeGreaterThan(0);
    expect(effect).toMatch(/if \(connected === false\) return;/);
    expect(effect).toMatch(/readLastOpenedSessionId\(keyValueStorage\)/);
    // The `false` check is strict on purpose: an absent prop must not gate anything.
    expect(effect).not.toMatch(/if \(!connected\) return;/);
  });
});

describe("SessionsScreen source: T362 A1's bar, search field and filter chips", () => {
  const code = readScreenCode();

  it("opens with the shared ScreenBar rather than a header of its own", () => {
    expect(code).toMatch(/import\s*\{\s*ScreenBar\s*\}\s*from\s*"\.\.\/\.\.\/ui\/recipes"/);
    expect(code).toMatch(/<ScreenBar\b/);
    expect(code).toMatch(/title="Sessions"/);
  });

  it("only offers the close action when a caller gave it somewhere to go", () => {
    // This screen is also a tab, where there is nothing to close back to.
    expect(code).toMatch(/leading=\{\s*onClose\s*\?/);
    expect(code).toMatch(/:\s*undefined\s*\}/);
  });

  it("makes the bar's search mark move the cursor into the real field", () => {
    expect(code).toMatch(/onPress:\s*\(\)\s*=>\s*searchRef\.current\?\.focus\(\)/);
    expect(code).toMatch(/<SearchField\b[\s\S]*?ref=\{searchRef\}/);
  });

  it("draws the four chips from the model's own list, never a local copy", () => {
    expect(code).toMatch(/SESSION_FILTER_CHIPS\.map\(\(chip\)\s*=>/);
    expect(code).not.toMatch(/"Needs you"/);
  });

  it("reports chip selection to TalkBack as state, not as a colour", () => {
    expect(code).toMatch(/accessibilityState=\{\{\s*selected\s*\}\}/);
    expect(code).toMatch(/accessibilityLabel=\{sessionFilterChipAccessibilityLabel\(chip\)\}/);
  });

  // CORRECTED (AND-SESSIONS-CHIP): this pinned `theme.colors["accent-tint"]`
  // background and `theme.colors["accent-ink"]` text, and its title claimed
  // the ring dropped only on the unselected chip. Grepped directly against
  // `android-spec.html`: `accent-tint`/`accent-ink` occur zero times: the
  // real `.chip[data-on]` rule is a SOLID `background:var(--accent)` with
  // `color:#08131f`, and it sets no `box-shadow`, so the base ring is kept
  // on BOTH states, not dropped on selection. `#08131f` has no exact token;
  // `accent`/`accentContrast` is the same solid-fill/on-accent-text pair
  // `Button.tsx`'s primary variant, `PromptBar.tsx`'s send icon and
  // `Toggle.tsx`'s knob already use for this identical literal — see
  // `sessions-screen.tsx`'s `FilterChip` doc comment for the measured values.
  it("paints a selected chip with the artifact's solid accent/accentContrast pair, ringed in both states", () => {
    expect(code).toMatch(/backgroundColor: theme\.colors\.accent,/);
    expect(code).toMatch(/color: theme\.colors\.accentContrast/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{6}/);
    // The base ring (borderWidth/borderColor on `filterChip`) must not be
    // zeroed out again by a `filterChipSelected` override — the real
    // `.chip[data-on]` rule sets no `box-shadow`.
    expect(code).not.toMatch(/filterChipSelected: \{[^}]*borderWidth: 0/);
  });

  it("renders the filtered groups, with the model's name-and-count heading", () => {
    expect(code).toMatch(/visibleGroups\.map\(\(group\)\s*=>/);
    expect(code).toMatch(/title=\{sessionGroupLabel\(group\)\}/);
    // CORRECTED (T362): this pin used to read `title={group.label}` and
    // `model.groups.map`. The claim is unchanged — the heading still
    // comes from the group, and every group still renders — only the
    // heading's shape and the filtering in front of it are new.
    expect(code).not.toMatch(/model\.groups\.map/);
  });

  it("keeps every group's testID, so nothing that names one has to change", () => {
    expect(code).toMatch(/testId=\{`\$\{testId\}-group-\$\{group\.kind\}`\}/);
  });

  it("says a filter is hiding the rows instead of claiming there are none", () => {
    expect(code).toMatch(/sessionFilterEmptyMessage\(filterInput\)/);
    expect(code).toMatch(/testId=\{`\$\{testId\}-filtered-empty`\}/);
  });

  it("keeps the search and the chip out of listState", () => {
    // A refetch, an archive reconcile or a network resync all replace
    // `listState`; none of them may clear what the reader typed.
    expect(code).toMatch(/const \[query, setQuery\] = useState\(""\)/);
    expect(code).not.toMatch(/setListState\([^)]*query/);
  });
});

describe("SessionsScreen source: T363 A1's row", () => {
  const code = readScreenCode();

  it("draws the row as one raised pill, not a dashed rule", () => {
    expect(code).toMatch(/backgroundColor: theme\.colors\.surface/);
    expect(code).toMatch(/\.\.\.ringShadow\(theme, "card"\)/);
    expect(code).not.toMatch(/borderStyle: "dashed"/);
  });

  it("UI-A-SHAPE: draws the row at the Expressive md radius (22), matching the spec's .row{border-radius:var(--r-md)}, not the old literal 12", () => {
    expect(code).toMatch(/borderRadius: EXPRESSIVE_RADII\.md/);
    expect(code).not.toMatch(/const ROW_RADIUS/);
    expect(code).not.toMatch(/borderRadius: ROW_RADIUS/);
  });

  it("UI-X8: uses the artifact's own `.row { gap: 10px }`, not the 8px spacing token", () => {
    expect(code).toMatch(/const ROW_GAP = 10;/);
    expect(code).toMatch(/gap: ROW_GAP,/);
  });

  it("T385: keeps the row at the artifact's 52dp, above the platform's touch minimum", () => {
    expect(code).toMatch(/const ROW_MIN_HEIGHT = 52;/);
    expect(code).toMatch(/minHeight: ROW_MIN_HEIGHT/);
  });

  it("prints the age from the model, against one clock reading for the whole list", () => {
    // Two rows updated in the same second must not disagree about when
    // that was.
    expect(code).toMatch(/const nowMs = Date\.now\(\);/);
    expect(code).toMatch(/sessionAgeLabel\(rawSession\.updatedAt, nowMs\)/);
    expect(code).toMatch(/\{sessionRowMetaWithAge\(row, age\)\}/);
  });

  it("invents neither of the artifact's two unavailable figures", () => {
    // "18 turns · 184k" — `SessionSummary` carries neither.
    //
    // CORRECTED at the P10-W15 merge gate. Both patterns held a literal
    // BACKSPACE control character (U+0008) where a word boundary was
    // meant. That is the signature of a two-character regex escape
    // written inside a non-raw Python string by whatever generated this
    // block: there the sequence is an escape for that control character,
    // not the two literal characters a JavaScript regex needs. Because
    // both cases are `.not.toMatch`, a pattern that can never match
    // passes every single time - two committed assertions that could not
    // fail, which is the shape this repository closes elsewhere under
    // the name of a check that cannot fail. The boundaries are restored
    // below, and both cases still pass: measured against the real
    // stripped source, which contains neither figure.
    expect(code).not.toMatch(/\bturns\b/);
    expect(code).not.toMatch(/\d+k\b/);
  });

  it("gives the pill a dot only where the state is worth one", () => {
    expect(code).toMatch(/showDot=\{row\.tone !== "neutral"\}/);
  });

  it("keeps Archive and Delete reachable", () => {
    // The artifact draws no such affordance; deleting two working
    // controls to match a picture would remove shipped capability.
    expect(code).toMatch(/testId=\{`\$\{testId\}-archive`\}/);
    expect(code).toMatch(/testId=\{`\$\{testId\}-delete`\}/);
  });
});

describe("SessionsScreen source: T364 A1's bottom row", () => {
  const code = readScreenCode();

  it("reveals the create form from the chip instead of leaving it above the list", () => {
    expect(code).toMatch(/\{createFormVisible \? \(/);
    expect(code).toMatch(/testID=\{`\$\{testId\}-create-new`\}/);
  });

  it("forces the form open while a submission has failed", () => {
    // Otherwise the error banner sits behind a collapsed form the
    // reader has no reason to reopen.
    expect(code).toMatch(
      /const createFormVisible = createFormOpen \|\| createState\.phase === "error";/,
    );
  });

  it("closes the form once the session exists", () => {
    expect(code).toMatch(
      /setCreateState\(markCreateSessionSucceeded\(\)\);\s*setCreateFormOpen\(false\);/,
    );
  });

  it("tells TalkBack whether the form is open, and renames the button accordingly", () => {
    expect(code).toMatch(/accessibilityState=\{\{ expanded: createFormVisible \}\}/);
    expect(code).toMatch(/createFormVisible \? "Hide the new session form" : "New session"/);
  });

  it("draws no home button, whose target this app does not have", () => {
    // `{ type: "host" }` resolves to `/h/:serverId`, which Expo Router
    // sends back to this very list.
    expect(code).not.toMatch(/onOpenHome/);
    expect(code).not.toMatch(/\u2302/);
  });

  it("names the gear rather than announcing its glyph", () => {
    expect(code).toMatch(/accessibilityLabel="Settings"/);
    expect(code).toMatch(/importantForAccessibility="no-hide-descendants"/);
  });

  it("keeps both bottom buttons at the platform's touch minimum", () => {
    expect(code).toMatch(/const ACTION_BUTTON_SIZE = 48;/);
    expect(code).toMatch(/minHeight: ACTION_BUTTON_SIZE,\s*minWidth: ACTION_BUTTON_SIZE,/);
  });
});

describe("SessionsScreen source: T385 A1 chrome, body and rows", () => {
  const code = readScreenCode();

  it("keeps the bar above the one scrolling body, so it cannot scroll away", () => {
    expect(code).toMatch(/<View style=\{styles\.screen\}>[\s\S]*?<ScreenBar[\s\S]*?<ScrollView/);
    expect(code).toMatch(/contentContainerStyle=\{styles\.body\}/);
  });

  it("gives the scrolling body the artifact's 12dp padding and 8dp gap", () => {
    expect(code).toMatch(
      /body: \{\s*padding: theme\.spacing\[3\],\s*gap: theme\.spacing\[2\],?\s*\}/,
    );
  });

  it("draws the row as the artifact's 52dp, Expressive-md-radius pill with an ink-3 mono meta line", () => {
    expect(code).toMatch(/borderRadius: EXPRESSIVE_RADII\.md/);
    expect(code).toMatch(/const ROW_MIN_HEIGHT = 52;/);
    expect(code).toMatch(/minHeight: ROW_MIN_HEIGHT/);
    expect(code).toMatch(/color: theme\.colors\["ink-3"\]/);
    expect(code).toMatch(/fontFamily: theme\.typography\.variant\.code\.fontFamily/);
  });

  // CORRECTED (AND-SESSIONS-CHIP): this pinned 28dp. Extracted directly
  // from `android-spec.html`'s real `.chip` rule (`height:30px;padding:0
  // 13px;font:500 12px/1 Inter,sans-serif`), which matches no site's prior
  // "28dp, 11dp padding, 11.5px font" citation verbatim: the true figures
  // are 30/13/12.
  it("sizes the chips to the artifact's 30dp and pads the touch target back to 48", () => {
    expect(code).toMatch(/const FILTER_CHIP_HEIGHT = 30;/);
    expect(code).toMatch(/hitSlop=\{10\}/);
  });

  it("puts the bottom row outside the scroller, so a long list cannot scroll the create button away", () => {
    const scrollEnd = code.indexOf("</ScrollView>");
    const actionRow = code.indexOf("styles.actionRow");
    expect(scrollEnd).toBeGreaterThan(-1);
    expect(actionRow).toBeGreaterThan(scrollEnd);
  });

  it("draws the gear as the artifact's bare button — no surface fill and no ring — unlike the raised create chip", () => {
    expect(code).toMatch(/style=\{styles\.settingsButton\}/);
    const settingsStyle = /settingsButton: \{([\s\S]*?)\n    \},/.exec(code)?.[1] ?? "";
    expect(settingsStyle).toMatch(/minHeight: ACTION_BUTTON_SIZE/);
    expect(settingsStyle).not.toMatch(/backgroundColor|ringShadow|borderWidth|borderColor/);
    expect(code).toMatch(
      /newSessionButton: \{[\s\S]*?backgroundColor: theme\.colors\.surface[\s\S]*?ringShadow\(theme, "card"\)/,
    );
  });

  // UI-A3: the artifact's `.chip { border-radius: 999px }` is a fully
  // rounded pill. T385 drew "+ New session" at `radii.control` (8) behind
  // a comment citing a 7px figure that appears nowhere in the artifact's
  // CSS -- this pins the corrected token and that the stale figure is gone.
  it("draws '+ New session' at the artifact's fully-rounded pill radius, not the 8dp control radius", () => {
    // Bounded to just this block's own closing brace (the same technique
    // the gear/create-chip case above uses) -- an unbounded `[\s\S]*?`
    // would run straight through into `settingsButton`'s own, unrelated
    // `borderRadius: theme.radii.control` a few lines below.
    const newSessionButtonStyle = /newSessionButton: \{([\s\S]*?)\n    \},/.exec(code)?.[1] ?? "";
    expect(newSessionButtonStyle).toMatch(/borderRadius: theme\.radii\.full/);
    expect(newSessionButtonStyle).not.toMatch(/borderRadius: theme\.radii\.control/);
    // The stale "7px" figure lived in a comment, so this must read the raw
    // (unstripped) source -- `code` above already has comments removed and
    // could never see it either way.
    expect(readScreenSource()).not.toMatch(/7px/);
  });
});

// PAD-FADEUP (P10-W15): the spec's `.pad>.row,.pad>.card` entrance is
// wired HERE, not merely available from the primitives barrel. This
// case exists because six defects in this session's own waves took one
// shape - a component built, exported, type-correct, and reached by
// nothing. A `PadEntrance` that no screen renders would pass every case
// in `../../ui/primitives/pad-entrance-model.test.ts` and
// `PadEntrance.test.ts` and still ship a screen with no entrance at
// all, so the wiring needs an assertion of its own against the screen's
// own source.
describe("PAD-FADEUP: the Sessions screen renders the pad entrance (P10-W15)", () => {
  it("wraps its animated pad children in PadEntrance, and every opening tag carries both a kind and a position", () => {
    const code = readScreenCode();
    expect(code).toMatch(/<PadEntrance[\s>]/);
    const openTags = code.match(/<PadEntrance[\s\S]*?>/g) ?? [];
    expect(openTags.length).toBeGreaterThan(0);
    for (const tag of openTags) {
      // `kind` decides whether the child animates at all; `position` is
      // the `:nth-child` index the spec's 45ms schedule is keyed to.
      // Either one omitted is a silent default, never a type error.
      expect(tag).toMatch(/kind=/);
      expect(tag).toMatch(/position=/);
    }
  });

  it("reads the delay schedule from the shared model instead of restating the spec's step here", () => {
    const code = readScreenCode();
    // The 45ms step and the eighth-child boundary live in
    // `pad-entrance-model.ts`, where a real vitest run executes them. A
    // screen computing its own delay would be provable only by source
    // text, which is exactly what that module exists to avoid.
    expect(code).not.toMatch(/45\s*\*/);
    expect(code).not.toMatch(/animationDelay/);
  });
});
