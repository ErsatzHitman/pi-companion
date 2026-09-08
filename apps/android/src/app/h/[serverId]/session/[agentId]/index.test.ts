import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `/h/:serverId/session/:agentId` route stub coverage — T32S1C, closing
 * T32S1's open second acceptance criterion for `CompactSessionShell`,
 * T32S2's mount of `TranscriptHeader`/`TranscriptStatusStrip`/`Composer`
 * into its `header`/`statusStrip`/`composer` slots, T32S3's `transcript`
 * slot (item 1) and live connection status (item 6), and T32S4's
 * interleaved thinking rows and `liveExtension` slot mount (items 1-2).
 * Source-level contract test, same reason as
 * `../../../../../app-shell/compact-shell.test.ts`: this module imports
 * `react-native`.
 *
 * This file only proves *that* the composed/interleaved list is fed to
 * both row components and *that* `PinnedLiveExtensionArea` is mounted
 * against the real store/controller — never a text match standing in
 * for the ordering decision itself. The ordering guarantee (message and
 * thinking entries interleaved in `buildTranscriptEntries`'s own order,
 * unrelated kinds dropped) is proven directly against
 * `buildSessionTranscriptEntries` in
 * `../../../../../app-shell/session-transcript-model.test.ts`,
 * with real fixtures and real assertions, not a regex.
 *
 * `readCode()` strips comments before matching — this file's own doc
 * comment names every symbol these assertions check for, so an
 * unanchored match against the raw source (including comments) would
 * stay green even if the real import/JSX were deleted. See
 * `../../../../../features/transcript/transcript-accessibility.test.ts`'s
 * doc comment for the concrete precedent this guards against.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./index.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * `readCode()` sliced down to a single top-level component's body.
 *
 * P5-W16 merge gate: `SessionTranscript` and `SessionApprovals` each read
 * `hapticsEnabled` off the one shared `AppCore.settings` controller with a
 * *byte-identical* `useState`/`subscribe`/`load` block. A whole-file
 * `toMatch` for that block therefore stayed green when either one of the
 * two was reverted to a hardcoded `true` — it proved "at least one call
 * site is wired", never the specific call site the assertion's own name
 * claims. Any assertion about a block that occurs more than once in
 * `index.tsx` must run against this slice rather than `readCode()`.
 */
function readComponentCode(name: string): string {
  const body = readCode()
    .split(/^function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith(`function ${name}(`));
  expect(body, `index.tsx should declare a top-level function ${name}`).toBeDefined();
  return body ?? "";
}

describe("SessionRoute source", () => {
  it("renders CompactSessionShell from its app-shell/ home", () => {
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/app-shell\/compact-shell"/);
    expect(readCode()).toMatch(/<CompactSessionShell/);
  });

  it("fills header with TranscriptHeader and statusStrip with TranscriptStatusStrip, both from features/transcript", () => {
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/transcript"/);
    expect(readCode()).toMatch(/header=\{[\s\S]*?<TranscriptHeader\b/);
    expect(readCode()).toMatch(/statusStrip=\{<TranscriptStatusStrip\b/);
  });

  // --- T79: the files/terminal in-app navigation entry points, mounted
  // as a sibling of TranscriptHeader inside the same header slot -------

  it("mounts SessionNavActions from app-shell/session-nav-actions as a sibling of TranscriptHeader inside the header slot, given this route's own serverId/agentId", () => {
    const code = readCode();
    expect(code).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/app-shell\/session-nav-actions"/);
    expect(code).toMatch(
      /header=\{\s*<>\s*<TranscriptHeader[\s\S]*?\/>\s*<SessionNavActions serverId=\{serverId \?\? ""\} agentId=\{agentId \?\? ""\} \/>\s*<\/>\s*\}/,
    );
  });

  it("fills composer with Composer from features/composer, given a turnService and turnRunning", () => {
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/composer"/);
    expect(readCode()).toMatch(/composer=\{[\s\S]*?<Composer\b/);
    expect(readCode()).toMatch(/turnService=\{turnService\}/);
    // T32S13 (P5-W19): `turnRunning={false}` was a live negative pin on
    // exactly the fixed-literal gap this task closed — see the case
    // below for what replaced it.
    expect(readCode()).toMatch(/turnRunning=\{turnRunning\}/);
    expect(readCode()).not.toMatch(/turnRunning=\{false\}/);
    expect(readCode()).toMatch(/onSubmit=\{handleSubmit\}/);
  });

  // --- T32S13 (P5-W19): the composer's onSubmit used to be a fixed,
  // module-level `function handleSubmit(_text: string) {}` no-op — "the
  // single most visible gap in the app" this task's brief named.
  // T63's `startDaemonTurn`/`core.startTurn` reaching the client is
  // proven end-to-end in `../../../../../app-shell/core.test.ts`
  // (`AppCore.startTurn`); this file proves the *wiring*: that
  // `SessionRoute`'s own `handleSubmit` is the one the `Composer`
  // actually receives, and that it calls `core.startTurn`, not that the
  // handler is merely non-empty.

  it("wires onSubmit to a local handleSubmit that calls core.startTurn(agentId, text), never the removed module-level no-op", () => {
    expect(readCode()).not.toMatch(/function handleSubmit\(_text: string\) \{\}/);
    // `SessionRoute` is `export default function SessionRoute()`, which
    // `readComponentCode`'s `^function ` split does not match (see that
    // helper's own doc comment) -- `handleSubmit`/`turnRunning` are
    // unique strings in this file (no sibling component declares
    // either), so a direct `readCode()` match is anchored to this one
    // call site without it, the same reasoning the turnService `useMemo`
    // case above already uses.
    const code = readCode();
    expect(code).toMatch(
      /const handleSubmit = useCallback\(\s*async \(text: string\) => \{[\s\S]*?await core\.startTurn\(agentId \?\? "", text\)[\s\S]*?\},\s*\[core, agentId\],?\s*\);/,
    );
  });

  it("guards against overlapping turns with a local submitting state, true only while a startTurn request is in flight", () => {
    const code = readCode();
    expect(code).toMatch(/const \[submitting, setSubmitting\] = useState\(false\);/);
    expect(code).toMatch(
      /async \(text: string\) => \{\s*setSubmitting\(true\);\s*try \{[\s\S]*?\} finally \{\s*setSubmitting\(false\);\s*\}/,
    );
  });

  // --- T64's real turnRunning signal, landed mid-wave and filed against
  // this exact mount seam (`turn-running-signal.ts`'s own doc comment).

  it("mounts T64's createTurnRunningSignal, imported directly from features/sessions (not the barrel, which does not export it)", () => {
    const code = readCode();
    expect(code).toMatch(
      /from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/sessions\/turn-running-signal\.js"/,
    );
    expect(code).toMatch(
      /const signal = createTurnRunningSignal\(\s*daemonSource,\s*agentId,\s*setSignalRunning,\s*connectionStatusSource,?\s*\);/,
    );
    expect(code).toMatch(/return \(\) => signal\.dispose\(\);/);
  });

  it("adapts AppCore.subscribeAgentStream (the one live agent_stream fan-out, not a second subscription) and AppCore.connection.subscribe into the signal's DaemonTurnStreamSource/ConnectionStatusSource shapes", () => {
    const code = readCode();
    expect(code).toMatch(
      /const daemonSource: DaemonTurnStreamSource = \{\s*on: \(_type, handler\) =>\s*core\.subscribeAgentStream\(/,
    );
    expect(code).toMatch(
      /const connectionStatusSource: ConnectionStatusSource = \{\s*subscribeConnectionStatus: \(listener\) =>\s*core\.connection\.subscribe\(\(snapshot\) => listener\(\{ status: snapshot\.phase \}\)\),\s*\};/,
    );
  });

  it("renders turnRunning as submitting OR'd with T64's real signalRunning -- neither alone", () => {
    const code = readCode();
    expect(code).toMatch(/const \[signalRunning, setSignalRunning\] = useState\(false\);/);
    expect(code).toMatch(/const turnRunning = submitting \|\| signalRunning;/);
  });

  it("re-throws a failed startTurn result so Composer's own optimistic markEntryFailed path surfaces it, rather than a second error path here", () => {
    // `SessionRoute` is `export default function SessionRoute()`, which
    // `readComponentCode`'s `^function ` split does not match (see that
    // helper's own doc comment) -- `handleSubmit`/`turnRunning` are
    // unique strings in this file (no sibling component declares
    // either), so a direct `readCode()` match is anchored to this one
    // call site without it, the same reasoning the turnService `useMemo`
    // case above already uses.
    const code = readCode();
    expect(code).toMatch(
      /if \(result\.status === "failed"\) \{\s*throw new Error\(result\.message\);\s*\}/,
    );
  });

  // T32S12 (P5-W18): this route used to pass a fixed, module-level
  // `NO_OP_TURN_SERVICE` no-op stand-in — a live negative pin
  // (`turnService={NO_OP_TURN_SERVICE}`) on exactly the thing T63's
  // `createDaemonTurnService` was built to replace. Anchored to
  // `SessionRoute` itself (not a whole-file match) since `useMemo` also
  // appears in `SessionSheetExtensions` below for an unrelated value.
  it("builds turnService from useAppCore().createTurnService(agentId), memoized on [core, agentId] -- never the removed NO_OP_TURN_SERVICE stand-in", () => {
    // `SessionRoute` is `export default function SessionRoute()`, which
    // `readComponentCode`'s `^function ` split does not match (see that
    // helper's own doc comment for what it's for) -- this exact
    // `useMemo(...)` expression is unique in the file (`SessionSheetExtensions`
    // below has its own, differently-shaped `useMemo` call), so a direct
    // `readCode()` match is anchored to this one call site without it.
    expect(readCode()).toMatch(
      /const turnService = useMemo\(\(\) => core\.createTurnService\(agentId \?\? ""\), \[core, agentId\]\);/,
    );
    expect(readCode()).not.toMatch(/NO_OP_TURN_SERVICE/);
  });

  it("derives TranscriptHeader's hostLabel/sessionTitle from this route's own serverId/agentId params", () => {
    expect(readCode()).toMatch(
      /useLocalSearchParams<\{\s*serverId:\s*string;\s*agentId:\s*string\s*\}>/,
    );
    expect(readCode()).toMatch(/hostLabel=\{serverId/);
    expect(readCode()).toMatch(/sessionTitle=\{agentId/);
  });

  it("does not claim TranscriptHeader/TranscriptStatusStrip/Composer read useLocalSearchParams themselves", () => {
    expect(readCode()).not.toMatch(/each read `useLocalSearchParams` themselves/);
  });

  // --- T32S3 item (1) / T32S4 item (1): the transcript slot -------------

  it("fills the transcript slot, and it renders TranscriptMessageRow fed by createTranscriptMessageBatcher", () => {
    expect(readCode()).toMatch(/transcript=\{<SessionTranscript/);
    expect(readCode()).toMatch(/createTranscriptMessageBatcher\(/);
    expect(readCode()).toMatch(/<TranscriptMessageRow\b/);
  });

  it("subscribes to the batcher's entries and disposes it on unmount", () => {
    expect(readCode()).toMatch(/batcher\.subscribe\(/);
    expect(readCode()).toMatch(/batcher\.dispose\(\)/);
  });

  // --- T32S8, item 2: feeds the batcher from AppCore's live agent_stream
  // subscription, and tears down that listener on unmount alongside the
  // batcher's own subscription.

  it("forwards core.subscribeAgentStream messages straight to batcher.push, and unsubscribes it on unmount", () => {
    expect(readCode()).toMatch(
      /core\.subscribeAgentStream\(\(message\) => \{\s*batcher\.push\(message\);\s*\}\)/,
    );
    expect(readCode()).toMatch(/unsubscribeAgentStream\(\)/);
  });

  it("derives the rendered entries via buildSessionTranscriptEntries over the batcher's full state, not just getMessageEntries", () => {
    expect(readCode()).toMatch(/buildSessionTranscriptEntries\(/);
    expect(readCode()).toMatch(/coreTimeline\.buildTranscriptEntries\(batcher\.getState\(\)\)/);
  });

  it("renders a thinking entry through TranscriptThinkingRow, in the same list as message rows", () => {
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/transcript"/);
    expect(readCode()).toMatch(/entry\.kind === "thinking"/);
    expect(readCode()).toMatch(/<TranscriptThinkingRow\b/);
  });

  // --- T32S6: mounts T33A4's TranscriptToolCallRow ------------------------

  it("renders a tool-call entry through TranscriptToolCallRow, in the same interleaved list", () => {
    expect(readCode()).toMatch(/entry\.kind === "tool-call"/);
    expect(readCode()).toMatch(/<TranscriptToolCallRow\b/);
  });

  // --- T32S4 item (2): the liveExtension slot ----------------------------

  it("fills liveExtension with SessionLiveExtension, mounting PinnedLiveExtensionArea from features/extensions/registry-index", () => {
    expect(readCode()).toMatch(/liveExtension=\{<SessionLiveExtension/);
    expect(readCode()).toMatch(
      /from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/extensions\/registry-index"/,
    );
    expect(readCode()).toMatch(/<PinnedLiveExtensionArea\b/);
  });

  it("reads elements/revision from the real AppCore.piUiSession.store via usePiUiElements, and passes the real actionController — never a locally constructed store or controller", () => {
    expect(readCode()).toMatch(/usePiUiElements\(core\.piUiSession\.store, agentId\)/);
    expect(readCode()).toMatch(/actionController=\{core\.piUiSession\.actionController\}/);
    expect(readCode()).not.toMatch(/new (extensions\.)?PiUiElementStore\(/);
    expect(readCode()).not.toMatch(/new (extensions\.)?ExtensionActionController\(/);
  });

  // --- T32S3 item (6): live connection status ---------------------------

  it("derives status from AppCore.connection via useConnectionStatus and deriveSessionRouteStatus, not a literal", () => {
    expect(readCode()).toMatch(/useConnectionStatus\(core\.connection\)/);
    expect(readCode()).toMatch(/deriveSessionRouteStatus\(phase\)/);
    expect(readCode()).not.toMatch(/status="disconnected"/);
  });

  it("passes the derived status to both TranscriptHeader and TranscriptStatusStrip", () => {
    expect(readCode()).toMatch(/<TranscriptHeader[\s\S]*?status=\{status\}/);
    expect(readCode()).toMatch(/<TranscriptStatusStrip status=\{status\}/);
  });

  // --- T32S7 item (2): features/approvals/ gets a live importer ---------

  it("mounts SessionApprovals (ApprovalsContainer from features/approvals) as a sibling of CompactSessionShell, keyed by this route's own agentId", () => {
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/approvals"/);
    expect(readCode()).toMatch(
      /function SessionApprovals\(\{ sessionId \}: \{ sessionId: string \}\)/,
    );
    expect(readCode()).toMatch(
      /<ApprovalsContainer\s+sessionId=\{sessionId\}\s+client=\{client\}\s+vibrationPlatform=\{core\.vibrationPlatform\}\s+hapticsEnabled=\{hapticsEnabled\}\s*\/>/,
    );
    expect(readCode()).toMatch(/<SessionApprovals sessionId=\{agentId \?\? ""\} \/>/);
  });

  it("builds SessionApprovals' client from the real AppCore.connection's active lifecycle, cast to DaemonPermissionsSource, never a fake constructed here", () => {
    expect(readCode()).toMatch(
      /core\.connection\.getActiveLifecycle\(\)\?\.getDaemonClient\(\) as unknown as\s*\|\s*DaemonPermissionsSource\s*\|\s*undefined/,
    );
    expect(readCode()).not.toMatch(/client=\{undefined\}/);
  });

  // --- T32S9: threads AppCore.vibrationPlatform down so ApprovalsContainer can fire the "approval"/"blocked" §9.3 haptics ---

  it("threads AppCore.vibrationPlatform into SessionApprovals' ApprovalsContainer, never leaving it unset", () => {
    expect(readCode()).toMatch(/vibrationPlatform=\{core\.vibrationPlatform\}/);
    expect(readCode()).not.toMatch(/vibrationPlatform=\{undefined\}/);
  });

  // --- T32S11 (P5-W16): closes the approvals half of the same hardcoded-`true` haptics gap, at its actual root ---

  it("threads AppCore.settings' real hapticsEnabled snapshot into SessionApprovals' ApprovalsContainer, never leaving it to ApprovalsContainer's/use-approvals-queue's own `= true` defaults", () => {
    const code = readCode();
    expect(code).toMatch(/hapticsEnabled=\{hapticsEnabled\}/);
    expect(code).not.toMatch(/hapticsEnabled=\{true\}/);
    // SessionApprovals reads its own hapticsEnabled state off the same
    // AppCore.settings controller SessionTranscript reads -- a second,
    // independent subscription to the one shared instance, not a private
    // read of storage and not a second SettingsController.
    expect(code).toMatch(
      /function SessionApprovals\(\{ sessionId \}: \{ sessionId: string \}\) \{\s*const core = useAppCore\(\);/,
    );
    // ...and that read is anchored to SessionApprovals' own body, so the
    // identical block in SessionTranscript cannot satisfy it on this call
    // site's behalf (P5-W16 merge gate).
    expect(readComponentCode("SessionApprovals")).toMatch(
      /const \[hapticsEnabled, setHapticsEnabled\] = useState\(\s*\(\) => core\.settings\.getSnapshot\(\)\.hapticsEnabled,?\s*\)/,
    );
  });

  // --- P5-W13 merge gate: the real per-agent id T33B7 filed back to app/ ---

  it("scopes the Composer's outbox entries to this route's own agentId, never leaving the \"local\" default", () => {
    const code = readCode();
    expect(code).toMatch(/<Composer\s+sessionId=\{agentId \?\? ""\}/);
    expect(code).not.toMatch(/sessionId="local"/);
  });

  // --- P5-W13 merge gate: the "finished"/"error" §9.3 triggers T33A6 built and nothing mounted ---

  it('fires the "finished"/"error" §9.3 haptics from SessionTranscript off a real TranscriptStatus transition', () => {
    const code = readCode();
    // The firing function comes from the transcript barrel, not a second
    // local copy of the decision.
    expect(code).toMatch(/fireTranscriptStatusHaptic,/);
    expect(code).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/transcript"/);
    // SessionTranscript takes the same TranscriptStatus the statusStrip
    // slot renders, so the haptic and its visible signal cannot disagree.
    expect(code).toMatch(
      /function SessionTranscript\(\{ status, agentId \}: \{ status: TranscriptStatus; agentId: string \}\)/,
    );
    expect(code).toMatch(
      /transcript=\{<SessionTranscript status=\{status\} agentId=\{agentId \?\? ""\} \/>\}/,
    );
    expect(code).toMatch(/<TranscriptStatusStrip status=\{status\} \/>/);
    // The real, process-lifetime platform is what fires - never an
    // unset/undefined one (which fireHaptic would silently no-op on).
    expect(code).toMatch(
      /fireTranscriptStatusHaptic\(\s*core\.vibrationPlatform,\s*hapticsEnabled,\s*previousStatusRef\.current,\s*status,?\s*\)/,
    );
    expect(code).not.toMatch(/fireTranscriptStatusHaptic\(\s*undefined/);
    // A transition, not a level: the previous status is carried across
    // renders and updated after each call, so a steady status re-render
    // cannot re-fire.
    expect(code).toMatch(/const previousStatusRef = useRef<TranscriptStatus \| null>\(null\)/);
    expect(code).toMatch(/previousStatusRef\.current = status;/);
  });

  // --- T32S11 (P5-W16): the hardcoded `true` literal is gone, replaced by AppCore.settings ---

  it("reads hapticsEnabled from AppCore.settings' real SettingsController snapshot, never a hardcoded literal", () => {
    // Anchored to SessionTranscript's own body: SessionApprovals below
    // declares a byte-identical block, so an unanchored whole-file match
    // could not tell the two call sites apart (P5-W16 merge gate).
    const code = readComponentCode("SessionTranscript");
    expect(code).toMatch(
      /const \[hapticsEnabled, setHapticsEnabled\] = useState\(\s*\(\) => core\.settings\.getSnapshot\(\)\.hapticsEnabled,?\s*\)/,
    );
    expect(code).toMatch(/core\.settings\.subscribe\(/);
    expect(code).toMatch(/void core\.settings\.load\(\)/);
    // The literal this component used to pass as the second argument to
    // fireTranscriptStatusHaptic() is gone -- a real snapshot value
    // threads through instead (asserted above), not merely a renamed
    // constant still fixed at `true`.
    expect(code).not.toMatch(/fireTranscriptStatusHaptic\(\s*core\.vibrationPlatform,\s*true,/);
  });

  // --- T32S7 item (3): the timeline/transcript staleness announcement ---

  it("wires describeTimelineStaleness off the batcher's own state and renders it through the Banner primitive, never a bare label", () => {
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/platform\/offline"/);
    expect(readCode()).toMatch(
      /describeTimelineStaleness\(\{ stale: state\.stale, gap: state\.gap \}\)/,
    );
    expect(readCode()).toMatch(
      /<Banner tone="info" message=\{staleness\.text\} testId="session-transcript-staleness" \/>/,
    );
  });

  it("recomputes staleness on every batch alongside entries, not just once on mount", () => {
    expect(readCode()).toMatch(/setStaleness\(readStaleness\(\)\)/);
    expect(readCode()).toMatch(
      /batcher\.subscribe\(\(\) => \{[\s\S]*?setStaleness\(readStaleness\(\)\)/,
    );
  });

  // --- T95: surfaces AppCore.turnOutbox.getRecoveredTurns() (T76) -------

  it("derives recoveredTurns from core.turnOutbox.getRecoveredTurns() via selectRecoveredTurnsForSession, scoped to this route's own agentId", () => {
    const code = readComponentCode("SessionTranscript");
    expect(code).toMatch(
      /const readRecoveredTurns = \(\): AwaitingConfirmationTurn\[\] =>\s*selectRecoveredTurnsForSession\(core\.turnOutbox\.getRecoveredTurns\(\), agentId\);/,
    );
    expect(code).toMatch(
      /const \[recoveredTurns, setRecoveredTurns\] = useState<AwaitingConfirmationTurn\[\]>\(\(\) =>\s*readRecoveredTurns\(\),?\s*\);/,
    );
  });

  it("re-reads recoveredTurns once turnOutbox.open() settles, never a one-shot read that could race the cold-start recovery pass", () => {
    const code = readComponentCode("SessionTranscript");
    expect(code).toMatch(
      /void core\.turnOutbox\.open\(\)\.then\(\(\) => \{\s*if \(!cancelled\) \{\s*setRecoveredTurns\(readRecoveredTurns\(\)\);\s*\}\s*\}\);/,
    );
  });

  it("renders RecoveredTurnBanner (from the features/transcript barrel) fed the derived recoveredTurns, alongside the staleness Banner", () => {
    const code = readCode();
    expect(code).toMatch(/RecoveredTurnBanner,/);
    expect(code).toMatch(
      /<RecoveredTurnBanner\s+turns=\{recoveredTurns\}\s+outbox=\{core\.turnOutbox\.getOutbox\(\) \?\? undefined\}\s*\/>/,
    );
  });

  // --- T121: unifies the composer's and the recovered-turn banner's
  // OutboxController instance at this, the one production mount site.
  // See app-shell/core.ts's `turnOutbox` doc comment and this task's
  // report for the counting-fake proof that one instance now serves
  // both a composer-style enqueue/markFailed and a banner-style
  // confirmResend call. -----------------------------------------------

  it("T121: passes core.turnOutbox.getOutbox() ?? undefined as RecoveredTurnBanner's outbox prop — deleting this prop re-splits the instance and must fail", () => {
    const code = readComponentCode("SessionTranscript");
    expect(code).toMatch(
      /<RecoveredTurnBanner\s+turns=\{recoveredTurns\}\s+outbox=\{core\.turnOutbox\.getOutbox\(\) \?\? undefined\}\s*\/>/,
    );
  });

  it("T121: passes the identical core.turnOutbox.getOutbox() ?? undefined expression as Composer's outbox prop, not a second private instance", () => {
    // `SessionRoute` is `export default function SessionRoute()`, which
    // `readComponentCode`'s `^function ` split does not match (see that
    // helper's own doc comment) -- the `<Composer` JSX tag is unique in
    // this file (the only other occurrences of the bare identifier
    // `Composer` are its own import line and this doc comment, both
    // stripped/excluded by anchoring to the JSX tag itself), so a direct
    // `readCode()` match is anchored to this one call site without it,
    // the same reasoning `handleSubmit`/`turnRunning`'s cases above use.
    const code = readCode();
    expect(code).toMatch(
      /<Composer\s+sessionId=\{agentId \?\? ""\}\s+onSubmit=\{handleSubmit\}\s+onMicPress=\{handleMicPress\}\s+onAttachPress=\{handleAttachPress\}\s+turnRunning=\{turnRunning\}\s+turnService=\{turnService\}\s+queueModeClient=\{queueModeClient\}\s+turnStatusClient=\{turnStatusClient\}\s+transcribeClient=\{transcribeClient\}\s+slashCommandsClient=\{slashCommandsClient\}\s+editorTextClient=\{editorTextClient\}\s+attachmentSource=\{attachmentSource\}\s+cameraCapture=\{cameraCapture\}\s+outbox=\{core\.turnOutbox\.getOutbox\(\) \?\? undefined\}\s*\/>/,
    );
  });

  it("T121: SessionTranscript and SessionRoute pass the exact same outbox-resolving expression, never two differently-spelled reads that could drift apart", () => {
    const transcriptOutboxExpr = readComponentCode("SessionTranscript").match(
      /<RecoveredTurnBanner\s+turns=\{recoveredTurns\}\s+outbox=\{([^}]+)\}\s*\/>/,
    )?.[1];
    const composerOutboxExpr = readCode().match(/<Composer\b[\s\S]*?outbox=\{([^}]+)\}\s*\/>/)?.[1];
    expect(transcriptOutboxExpr).toBe("core.turnOutbox.getOutbox() ?? undefined");
    expect(composerOutboxExpr).toBe("core.turnOutbox.getOutbox() ?? undefined");
  });

  // --- T132: wires queueModeClient/turnStatusClient into the production
  // Composer mount, resolved off the real AppCore.connection's active
  // lifecycle (T32A1B) via ../../../../../app-shell/
  // session-route-daemon-clients.ts — see this component's own "T132
  // mount" doc comment. The P6-W10 merge gate moved that module out of
  // the Expo Router root, where it had no default export and would have
  // been registered as a broken route node (../../../../../app/
  // router-root.test.ts's own subject). Its own test
  // (../../../../../app-shell/session-route-daemon-clients.test.ts)
  // proves the resolve step
  // itself with a real counting fake; this file only proves the WIRING:
  // that SessionRoute actually calls it and actually passes the result
  // to Composer, never a fixed `undefined`. ------------------------------

  it("T132/T282/T284/T292/T293: imports resolveAttachmentDownloadClient/resolveEditorTextClient/resolveQueueModeClient/resolveSlashCommandsClient/resolveTranscribeClient/resolveTurnStatusClient from ../../../../../app-shell/session-route-daemon-clients", () => {
    expect(readCode()).toMatch(
      /import \{\s*resolveAttachmentDownloadClient,\s*resolveEditorTextClient,\s*resolveQueueModeClient,\s*resolveSlashCommandsClient,\s*resolveTranscribeClient,\s*resolveTurnStatusClient,?\s*\} from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/app-shell\/session-route-daemon-clients";/,
    );
  });

  it("T132: derives queueModeClient/turnStatusClient by calling the imported resolvers with core.connection, never a hard-coded literal", () => {
    // `SessionRoute` is `export default function SessionRoute()`, which
    // `readComponentCode`'s `^function ` split does not match (see that
    // helper's own doc comment) -- `queueModeClient`/`turnStatusClient`
    // are unique identifiers in this file (no sibling component
    // declares either), so a direct `readCode()` match is anchored to
    // this one call site without it, the same reasoning `handleSubmit`'s
    // case above uses.
    const code = readCode();
    expect(code).toMatch(/const queueModeClient = resolveQueueModeClient\(core\.connection\);/);
    expect(code).toMatch(/const turnStatusClient = resolveTurnStatusClient\(core\.connection\);/);
  });

  it("T132: passes both resolved values straight through to Composer's own props — deleting either prop must fail this assertion", () => {
    const code = readCode();
    expect(code).toMatch(/<Composer[\s\S]*?queueModeClient=\{queueModeClient\}/);
    expect(code).toMatch(/<Composer[\s\S]*?turnStatusClient=\{turnStatusClient\}/);
    // Never the fixed literal that would silently re-disable both
    // pickers regardless of connection state (the exact gap this task
    // closed).
    expect(code).not.toMatch(/queueModeClient=\{undefined\}/);
    expect(code).not.toMatch(/turnStatusClient=\{undefined\}/);
  });

  // --- T282: wires transcribeClient into the production Composer mount,
  // resolved the identical way as queueModeClient/turnStatusClient above
  // — see this component's own "T282 mount" doc comment. Before this
  // task the mic action genuinely requested and genuinely received a
  // real OS microphone permission (T276's real voiceCapture default) and
  // then always discarded the clip: nothing wired transcribeClient, so
  // every "audio" outcome resolved "transcription-unavailable" no matter
  // what the daemon connection state was. -------------------------------

  it("T282: derives transcribeClient by calling resolveTranscribeClient with core.connection, never a hard-coded literal", () => {
    const code = readCode();
    expect(code).toMatch(/const transcribeClient = resolveTranscribeClient\(core\.connection\);/);
  });

  it("T282: passes the resolved value straight through to Composer's own transcribeClient prop — deleting this prop must fail this assertion", () => {
    const code = readCode();
    expect(code).toMatch(/<Composer[\s\S]*?transcribeClient=\{transcribeClient\}/);
    // Never the fixed literal that would silently leave the mic wired to
    // nothing regardless of connection state — the exact gap this task
    // closed.
    expect(code).not.toMatch(/transcribeClient=\{undefined\}/);
  });

  // --- T292 (owner request): wires slashCommandsClient into the
  // production Composer mount, resolved the identical way as
  // queueModeClient/turnStatusClient/transcribeClient above — see this
  // component's own "T292 mount" doc comment. Before this task the
  // slash-command palette had no counterpart at all on Android, so
  // there was no prop and no resolver to wire. -------------------------

  it("T292: derives slashCommandsClient by calling resolveSlashCommandsClient with core.connection, never a hard-coded literal", () => {
    const code = readCode();
    expect(code).toMatch(
      /const slashCommandsClient = resolveSlashCommandsClient\(core\.connection\);/,
    );
  });

  it("T292: passes the resolved value straight through to Composer's own slashCommandsClient prop — deleting this prop must fail this assertion", () => {
    const code = readCode();
    expect(code).toMatch(/<Composer[\s\S]*?slashCommandsClient=\{slashCommandsClient\}/);
    // Never the fixed literal that would silently leave the palette
    // wired to nothing regardless of connection state.
    expect(code).not.toMatch(/slashCommandsClient=\{undefined\}/);
  });

  // --- T293: wires editorTextClient into the production Composer mount,
  // resolved the identical way as slashCommandsClient above — see this
  // component's own "T293" comment beside the mount. Before this task
  // `getEditorText`/`pasteToEditor` had no bridge on Android at all, so
  // there was no prop and no resolver to wire. -------------------------

  it("T293: derives editorTextClient by calling resolveEditorTextClient with core.connection, never a hard-coded literal", () => {
    const code = readCode();
    expect(code).toMatch(/const editorTextClient = resolveEditorTextClient\(core\.connection\);/);
  });

  it("T293: passes the resolved value straight through to Composer's own editorTextClient prop — deleting this prop must fail this assertion", () => {
    const code = readCode();
    expect(code).toMatch(/<Composer[\s\S]*?editorTextClient=\{editorTextClient\}/);
    // Never the fixed literal that would silently leave nothing answering
    // a getEditorText extension call regardless of connection state.
    expect(code).not.toMatch(/editorTextClient=\{undefined\}/);
  });

  // --- T284: wires resolveImageUri into TranscriptMessageRow inside
  // SessionTranscript's own renderRow — see that component's own "T284
  // mount" doc comment. Before this task no route anywhere threaded a
  // resolver through TranscriptMessageRowProps at all (the prop did not
  // exist), so every attachment always rendered the honest reference
  // card, on both platforms. Assertions run against
  // readComponentCode("SessionTranscript") rather than the whole file:
  // `resolveAttachmentDownloadClient(core.connection)` also appears (with
  // a different call site) nowhere else, but `useAttachmentImageResolver`
  // is imported once and called exactly once, inside this component. ---

  it("T284: imports useAttachmentImageResolver from the same features/transcript barrel as the row components", () => {
    const code = readCode();
    expect(code).toMatch(/useAttachmentImageResolver,/);
    expect(code).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/transcript"/);
  });

  it("T284: imports buildDaemonHttpOrigin from features/connect/daemon-connection-store, the same function the files route already derives its own downloadOrigin from", () => {
    expect(readCode()).toMatch(
      /import \{ buildDaemonHttpOrigin \} from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/connect\/daemon-connection-store\.js";/,
    );
  });

  it("T284: SessionTranscript derives downloadOrigin from useConnectionStatus(core.connection)'s daemonAddress, never a hard-coded literal", () => {
    const body = readComponentCode("SessionTranscript");
    expect(body).toMatch(/const \{ daemonAddress \} = useConnectionStatus\(core\.connection\);/);
    expect(body).toMatch(
      /const downloadOrigin = daemonAddress \? buildDaemonHttpOrigin\(daemonAddress\) : null;/,
    );
  });

  it("T284: SessionTranscript resolves the attachment client via resolveAttachmentDownloadClient(core.connection) and calls useAttachmentImageResolver with it, agentId, downloadOrigin, and entries", () => {
    const body = readComponentCode("SessionTranscript");
    expect(body).toMatch(
      /const attachmentDownloadClient = resolveAttachmentDownloadClient\(core\.connection\);/,
    );
    expect(body).toMatch(
      /const resolveImageUri = useAttachmentImageResolver\(\{\s*client: attachmentDownloadClient,\s*agentId,\s*downloadOrigin,\s*entries,\s*\}\);/,
    );
  });

  it("T284: passes the resolved resolveImageUri straight through to TranscriptMessageRow's own prop — deleting it must fail this assertion", () => {
    const body = readComponentCode("SessionTranscript");
    expect(body).toMatch(/<TranscriptMessageRow[\s\S]*?resolveImageUri=\{resolveImageUri\}/);
    // Never the fixed literal that would silently leave every attachment
    // wired to nothing regardless of connection state — the exact gap
    // this task closed.
    expect(body).not.toMatch(/resolveImageUri=\{undefined\}/);
  });

  // --- T290: wires real attachmentSource/cameraCapture ports into the
  // production Composer mount — see this component's own "T290 mount"
  // doc comment. Before this task both remained unset (the owner had
  // not yet installed `expo-image-picker`/`expo-document-picker`), so
  // the attach and camera-capture actions always resolved
  // `Composer.tsx`'s own `createUnavailableAttachmentSourcePort`/
  // `createUnavailableCameraCapturePort` fallbacks. Unlike
  // queueModeClient/turnStatusClient/transcribeClient above, these two
  // do not derive from `core.connection` at all — they are memoized
  // once with `useMemo`, since an OS document/camera picker works with
  // no daemon paired. -------------------------------------------------

  it("T290: imports createExpoAttachmentSourcePort/createExpoCameraCapturePort from ../../../../../features/composer", () => {
    const code = readCode();
    expect(code).toMatch(/createExpoAttachmentSourcePort/);
    expect(code).toMatch(/createExpoCameraCapturePort/);
    expect(code).toMatch(
      /import \{\s*Composer,\s*createExpoAttachmentSourcePort,\s*createExpoCameraCapturePort,?\s*\} from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/composer";/,
    );
  });

  it("T290: derives attachmentSource/cameraCapture with useMemo, calling each real constructor with no arguments and an empty dependency array", () => {
    const code = readCode();
    expect(code).toMatch(
      /const attachmentSource = useMemo\(\(\) => createExpoAttachmentSourcePort\(\), \[\]\);/,
    );
    expect(code).toMatch(
      /const cameraCapture = useMemo\(\(\) => createExpoCameraCapturePort\(\), \[\]\);/,
    );
  });

  it("T290: passes both resolved values straight through to Composer's own props — deleting either prop must fail this assertion", () => {
    const code = readCode();
    expect(code).toMatch(/<Composer[\s\S]*?attachmentSource=\{attachmentSource\}/);
    expect(code).toMatch(/<Composer[\s\S]*?cameraCapture=\{cameraCapture\}/);
    // Never the fixed literal that would silently leave attach/camera
    // wired to the unavailable fallback regardless of the real install
    // this task's dependency wall coming down made possible — the exact
    // gap this task closed.
    expect(code).not.toMatch(/attachmentSource=\{undefined\}/);
    expect(code).not.toMatch(/cameraCapture=\{undefined\}/);
  });

  // --- T32S10: TranscriptWindowList (T33A6) had no live importer --------

  it("renders the transcript through TranscriptWindowList, imported from the same features/transcript barrel as the row components, never a bare ScrollView", () => {
    const code = readCode();
    expect(code).toMatch(/TranscriptWindowList,/);
    expect(code).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/transcript"/);
    expect(code).toMatch(
      /<TranscriptWindowList\s+entries=\{entries\}\s+testId="session-transcript"/,
    );
    expect(code).not.toMatch(/<ScrollView/);
  });

  it("renderRow keeps the exact same per-kind switch and passes TranscriptWindowList's own row testId straight through, never reconstructing a literal", () => {
    const code = readCode();
    // Same three branches, same components, as before the swap - only the
    // container changed.
    expect(code).toMatch(
      /renderRow=\{\(entry, testId\) => \{[\s\S]*?entry\.kind === "thinking"[\s\S]*?<TranscriptThinkingRow key=\{entry\.id\} entry=\{entry\} live=\{false\} testId=\{testId\} \/>/,
    );
    expect(code).toMatch(
      /entry\.kind === "tool-call"[\s\S]*?<TranscriptToolCallRow key=\{entry\.id\} entry=\{entry\} testId=\{testId\} \/>/,
    );
    expect(code).toMatch(
      /<TranscriptMessageRow\s+key=\{entry\.id\}\s+entry=\{entry\}\s+streaming=\{false\}\s+resolveImageUri=\{resolveImageUri\}\s+testId=\{testId\}\s*\/>/,
    );
    // Never a hand-built `session-transcript-row-${entry.id}` template
    // literal anymore - TranscriptWindowList (features/transcript/
    // transcript-window.tsx) is the one and only place that string is
    // assembled now (as `${testId}-row-${item.id}`, off this route's own
    // `testId="session-transcript"` - byte-identical to the old literal).
    expect(code).not.toMatch(/`session-transcript-row-\$\{entry\.id\}`/);
  });
});

// --- T32S12 (P5-W18): the second live Pi UI mount point, T37E5's finding ---

describe("SessionSheetExtensions (T32S12, P5-W18)", () => {
  it("selects only sheet-placement elements via app-shell/sheet-extension-model, and renders each through PiUiElementView", () => {
    const code = readComponentCode("SessionSheetExtensions");
    expect(readCode()).toMatch(
      /from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/app-shell\/sheet-extension-model"/,
    );
    expect(code).toMatch(
      /const sheetElements = useMemo\(\(\) => selectSheetPlacementElements\(elements\), \[elements\]\);/,
    );
    expect(code).toMatch(/sheetElements\.map\(\(element\) => \(/);
    expect(code).toMatch(/<PiUiElementView\b/);
    expect(code).toMatch(/element=\{element\}/);
    expect(code).toMatch(/actionController=\{core\.piUiSession\.actionController\}/);
  });

  it("is mounted as a sibling of CompactSessionShell/SessionApprovals, keyed by this route's own agentId", () => {
    expect(readCode()).toMatch(/<SessionSheetExtensions agentId=\{agentId \?\? ""\} \/>/);
  });
});
