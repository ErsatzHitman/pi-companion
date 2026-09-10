import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { entryStatusLabel } from "../../src/features/composer/composer-model.js";
import { BACKGROUND_KILL_RESTORE_FLOW } from "./background-kill-restore-contract.js";
import { PRODUCTION_DAEMON_PORT } from "../harness/production-daemon-port.js";
import { assertVisibleTextsAfterEachTap, parseMaestroSteps } from "./maestro-yaml.js";

/**
 * T37E6 — proves every testId/string
 * `../../maestro/background-kill-restore.yaml` names still exists in
 * the real source it targets, and proves each of that flow's three
 * named premises independently rather than trusting the flow's own
 * prose. Same rationale and precedent as `pairing.contract.test.ts`
 * (T37E1) and `composer-inputs.contract.test.ts` (T37E3): there is no
 * emulator, device, or Maestro binary in this wave, so this file is
 * the flow's only proof of life.
 *
 * Two proof strategies, chosen per module (same split as the T37E3
 * precedent):
 *
 * - `composer-model.ts` is RN-free, so this file imports it directly
 *   and calls the real `entryStatusLabel` function.
 * - `Composer.tsx`, `session/[agentId]/index.tsx`, `core.ts`,
 *   `deep-link-routing.ts`, `app.config.ts`, and `platform/offline/
 *   index.ts` (all either reach `react-native` or are read as text
 *   alongside their RN siblings for one consistent anchoring style) are
 *   read with `readCode()` (comment-stripped) and matched against a
 *   full JSX/statement expression — never a bare identifier (CLAUDE.md's
 *   "SOURCE-TEXT REGEX TESTS ARE ON PROBATION" note). `readComponentCode`
 *   further anchors an assertion to the one top-level function that
 *   owns it, closing defect (5) from that note (a sibling occurrence of
 *   the same call satisfying a whole-file `toMatch`).
 *
 * This file deliberately re-derives the PREMISE 1 anchors
 * (`composer-inputs.contract.test.ts` already proves the identical
 * mechanism for T37E3's own flow) rather than importing that file —
 * `../../maestro/README.md`'s "Flow independence" rule applies to the
 * proof files too: this flow's proof must stand on its own.
 *
 * PREMISE 3, `core.ts`'s half, used to be proven as an *absence*
 * (`readCode()` strips comments before matching, so a `not.toMatch`
 * assertion was blind to a mere doc-comment mention and only failed if
 * the term appeared in real, executable code — the distinction between
 * "documented as the intended mount site" and "actually constructed").
 * **Closed by T76** (P5-W23): `core.ts` now really does construct a
 * `TurnOutboxOwner` and resend a recovered turn — see
 * `../../src/platform/offline/turn-outbox-owner.ts` and
 * `../../src/app-shell/turn-outbox-recovery.test.ts` (T76's own "arrives
 * at the transcript after a simulated process death" proof, in a
 * dedicated file rather than an addition to `core.test.ts`). The
 * `core.ts` assertion below is now a *positive* one, proving the mount
 * is real, not the retired absence claim — this is exactly the CLAUDE.md
 * "once the gap closes, flip the assertion, don't leave it pinned shut"
 * rule `composer-inputs.contract.test.ts`'s own doc comment already
 * anticipates. The session route's own half of PREMISE 3 is unchanged:
 * T76's mount lives entirely in `core.ts`, so that file still
 * constructs no `OutboxController` — a true absence, not a stale one.
 */

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Slices `readCode(relativePath)` down to one top-level `function`/`export function` declaration, by name — closes defect (5) (a sibling occurrence satisfying a whole-file match). */
function readComponentCode(relativePath: string, name: string): string {
  const code = readCode(relativePath);
  const body = code
    .split(/^(?:export default |export )?function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith(`function ${name}(`));
  expect(body, `${relativePath} should declare a top-level function ${name}`).toBeDefined();
  return body ?? "";
}

const COMPOSER_TSX = "../../src/features/composer/Composer.tsx";
const SESSION_ROUTE_TSX = "../../src/app/h/[serverId]/session/[agentId]/index.tsx";
const CORE_TS = "../../src/app-shell/core.ts";

describe("background-kill-restore.yaml anchors exist in source", () => {
  describe("the session route deep link this flow opens twice (initial + post-restore)", () => {
    it('app.config.ts registers the "picompanion" scheme the flow\'s openLink URL uses', () => {
      const code = readCode("../../app.config.ts");
      expect(code).toMatch(/scheme:\s*"picompanion",/);
    });

    it('deep-link-routing.ts matches "h/<serverId>/session/<agentId>" to kind "session"', () => {
      const code = readCode("../../src/app-shell/deep-link-routing.ts");
      expect(code).toMatch(
        /if \(rest\.length >= 2 && rest\[0\] === "session"\) \{\s*const agentId = rest\[1\];\s*const tail = rest\.slice\(2\);\s*\s*if \(tail\.length === 0\) \{\s*return \{ kind: "session", serverId, agentId \};/,
      );
    });

    it("no stored host profile exists for app/index.tsx's cold-start redirect to read, since this flow never calls saveHostProfile", () => {
      // Anchored to `IndexRoute`'s own comment-stripped body (P5-W20
      // merge gate). This used to be a bare `/useColdStartProfile/`
      // against the comment-PRESERVING whole file — defect class (5),
      // and decorative in fact, not just in principle: deleting the real
      // `const profile = useColdStartProfile();` call site left the
      // import statement and a doc-comment mention still matching, and
      // all 18 cases in this file still passed. The pin below is on the
      // call site and the redirect it feeds, so removing either fails.
      // T32S15 (this same wave) added a `hasInitialShare` branch ahead of
      // the `profile` one — this flow never sends a share intent, so
      // that branch stays false and the profile fallback below is what
      // still actually decides this flow's redirect; updated to match,
      // not re-pinned.
      const indexRoute = readComponentCode("../../src/app/index.tsx", "IndexRoute");
      expect(indexRoute).toMatch(/const profile = useColdStartProfile\(\);/);
      expect(indexRoute).toMatch(
        /const href = hasInitialShare\s*\?\s*"\/share"\s*:\s*profile\s*\?\s*destinationHref\(\{\s*type:\s*"sessionList",\s*serverId:\s*profile\.id\s*\}\)\s*:\s*"\/connect";/,
      );
      // This flow itself never submits ConnectForm, so on a real restart
      // (after PREMISE 2/3's stopApp below) that hook resolves to no
      // profile and this route would redirect to /connect — exactly why
      // the flow re-opens the deep link explicitly instead of relying on
      // this redirect.
    });
  });

  describe("PREMISE 1 — an unpaired send reconciles to Failed before any Maestro step can interleave", () => {
    it("SessionRoute mounts Composer with a real onSubmit wired to core.startTurn — no pairing needed to attempt a send", () => {
      const code = readComponentCode(SESSION_ROUTE_TSX, "SessionRoute");
      expect(code).toMatch(
        /<Composer\s+sessionId=\{agentId \?\? ""\}\s+onSubmit=\{handleSubmit\}\s+onMicPress=\{handleMicPress\}\s+onAttachPress=\{handleAttachPress\}\s+turnRunning=\{turnRunning\}\s+turnService=\{turnService\}\s+queueModeClient=\{queueModeClient\}\s+turnStatusClient=\{turnStatusClient\}\s+transcribeClient=\{transcribeClient\}\s+slashCommandsClient=\{slashCommandsClient\}\s+editorTextClient=\{editorTextClient\}\s+attachmentSource=\{attachmentSource\}\s+cameraCapture=\{cameraCapture\}\s+onMinHeightChange=\{setComposerContentMinHeight\}\s+outbox=\{core\.turnOutbox\.getOutbox\(\) \?\? undefined\}\s*\/>/,
      );
      expect(code).toMatch(
        /const handleSubmit = useCallback\(\s*async \(text: string\) => \{\s*setSubmitting\(true\);\s*try \{\s*const result = await core\.startTurn\(agentId \?\? "", text\);\s*if \(result\.status === "failed"\) \{\s*throw new Error\(result\.message\);/,
      );
    });

    it('no testId prop is passed to Composer, so it falls back to its own "composer" default', () => {
      const code = readComponentCode(SESSION_ROUTE_TSX, "SessionRoute");
      expect(code).not.toMatch(/<Composer[\s\S]*?testId=/);
    });

    it('core.ts\'s turn transport rejects synchronously with "Not connected to a daemon" when no client is active', () => {
      const code = readCode(CORE_TS);
      expect(code).toMatch(
        /sendMessage: \(targetAgentId, text, sendOptions\) => \{\s*const client = connection\s*\.getActiveLifecycle\(\)\s*\?\.getDaemonClient\(\) as unknown as DaemonTurnTransport \| null;\s*if \(!client\) return Promise\.reject\(new Error\("Not connected to a daemon"\)\);/,
      );
    });

    it('Composer defaults testId to "composer" and renders that as the Section root testID', () => {
      const code = readComponentCode(COMPOSER_TSX, "Composer");
      expect(code).toMatch(/const composerTestId = testId \?\? "composer";/);
      expect(code).toMatch(
        /<Section\s+title=\{COMPOSER_ACCESSIBILITY_LABEL\}\s+testId=\{composerTestId\}(?:\s+style=\{styles\.section\})?(?:\s+onTitleLayout=\{handleTitleLayout\})?\s*>/, // T338: multi-line, with the shrinkable-section style,
      );
    });

    it('submitDraft commits the entry as "pending" synchronously, before onSubmit is ever invoked', () => {
      const code = readCode("../../src/features/composer/composer-model.ts");
      expect(code).toMatch(
        /export function submitDraft\(state: ComposerState, deps: ComposerModelDeps\): SubmitDraftResult \{\s*const text = state\.draft\.trim\(\);\s*if \(text\.length === 0\) \{\s*return \{ state, entry: undefined \};\s*\}\s*const entry: ComposerEntry = \{\s*id: deps\.generateId\(\),\s*text,\s*status: "pending",/,
      );
    });

    // T75: a plain send used to settle through a local
    // `Promise.resolve().then(onSubmit)` chain straight to
    // `markEntryFailed` on rejection, bypassing the real
    // `OutboxController` entirely. It now reaches `sendWithOutbox`,
    // which awaits `onSubmit(text)` inside a try/catch and reconciles to
    // `markEntryFailed` on rejection there instead — the same unpaired
    // "Not connected to a daemon" -> `"Failed"` outcome this flow needs,
    // reached through the real outbox lifecycle rather than around it.
    it('a plain send (no attachments) reaches sendWithOutbox, which settles a rejected onSubmit(text) to markEntryFailed via "Not connected to a daemon"', () => {
      const code = readComponentCode(COMPOSER_TSX, "Composer");
      expect(code).toMatch(
        /const handleSend = useCallback\(\(\) => \{[\s\S]*?void sendWithOutbox\(entry\.id, entry\.text, attachmentsToSend\);\s*\}, \[state, generateId, sendWithOutbox\]\);/,
      );
      expect(code).toMatch(
        /const sendWithOutbox = useCallback\(\s*async \([\s\S]*?try \{[\s\S]*?await onSubmit\(text\);[\s\S]*?\} catch \(error\) \{[\s\S]*?setState\(\(current\) => markEntryFailed\(current, entryId\)\);\s*\}\s*\},\s*\[outbox, resolvedSessionId, onSubmit\],\s*\);/,
      );
    });

    it('entryStatusLabel("failed") is exactly "Failed", and is distinct from "Sent"', () => {
      expect(entryStatusLabel("failed")).toBe(BACKGROUND_KILL_RESTORE_FLOW.entryFailedLabel);
      expect(entryStatusLabel("sent")).not.toBe(BACKGROUND_KILL_RESTORE_FLOW.entryFailedLabel);
    });

    it("the entries container and composer-input/composer-send carry the testIds the flow taps/reads", () => {
      const composer = readComponentCode(COMPOSER_TSX, "Composer");
      expect(composer).toMatch(
        /<View\s+style=\{styles\.entries\}\s+accessibilityRole="none"\s+accessibilityLiveRegion="polite"\s+testID=\{`\$\{composerTestId\}-entries`\}\s*>/,
      );
      expect(composer).toMatch(
        /<PromptBar\s+label=\{COMPOSER_INPUT_LABEL\}[\s\S]{0,400}?testId=\{composerTestId\}\s*\/>/,
      );
    });
  });

  describe("PREMISE 2 — composer state is not persisted; a real kill loses the attempt entirely", () => {
    it("Composer.tsx's only state store is a plain useState seeded from EMPTY_COMPOSER_STATE", () => {
      const code = readCode(COMPOSER_TSX);
      expect(code).toMatch(/const \[state, setState\] = useState\(EMPTY_COMPOSER_STATE\);/);
      expect(code).not.toMatch(/AsyncStorage/);
      expect(code).not.toMatch(/KeyValueStorage/);
    });

    it("EMPTY_COMPOSER_STATE starts with no entries — exactly what a post-restart mount renders", () => {
      const code = readCode("../../src/features/composer/composer-model.ts");
      expect(code).toMatch(
        /export const EMPTY_COMPOSER_STATE: ComposerState = \{\s*draft: "",\s*entries: \[\],/,
      );
    });

    it("platform/offline/index.ts's own doc comment independently confirms the outbox/recovery half now also has a production construction site (T76, this wave — closed after T68 gave only the OfflineCache half an owner)", () => {
      const wholeSrc = readSource("../../src/platform/offline/index.ts");
      // Superseded twice now: T68 (P5-W20) gave `OfflineCache` a real
      // (if `"degraded"`, since expo-sqlite is still missing) lifecycle
      // owner and explicitly carved the `createTurnOutbox`/
      // `recoverInFlightTurns` half out as still ownerless; T76 (this
      // wave, P5-W23) closed that half too — `./turn-outbox-owner.ts`'s
      // `TurnOutboxOwner`. This assertion pins the current claim, not
      // either retired one.
      expect(wholeSrc).toMatch(
        /`\.\/turn-outbox-owner\.ts`'s `TurnOutboxOwner`\/`createTurnOutboxOwner`/,
      );
      expect(wholeSrc).toMatch(/`AppCore\.turnOutbox` is this task's own mount site/);
      expect(wholeSrc).toMatch(
        /see\s*\n \* that file's `resumePendingTurnOutboxEntries` for how a `"resumed"`\s*\n \* row is actually resent \(never a silent auto-resend of an\s*\n \* `"awaiting-confirmation"` one\)\./,
      );
    });
  });

  describe("PREMISE 3 — T37C's recoverInFlightTurns is real and unit-tested, but unmounted; restore proves survival, not recovery", () => {
    it("turn-recovery.ts really exports recoverInFlightTurns and createTurnOutbox (the unit-tested, unmounted recovery pass)", () => {
      const code = readCode("../../src/platform/offline/turn-recovery.ts");
      expect(code).toMatch(/export async function recoverInFlightTurns\(/);
      expect(code).toMatch(/export function createTurnOutbox\(/);
    });

    it("core.ts — the doc-commented intended mount site — now really constructs a TurnOutboxOwner and resends a recovered turn (T76 closed this gap; positive assertion, not the retired absence claim)", () => {
      const code = readCode(CORE_TS);
      // `core.ts` itself never spells `createTurnOutbox`/
      // `recoverInFlightTurns`/`OutboxController`/`SqliteStructuredStorage`
      // literally — it goes through `TurnOutboxOwner`
      // (`../platform/offline/turn-outbox-owner.ts`), which is where
      // those names actually live (see that file's own tests). What
      // `core.ts` must show, and now does, is the real construction,
      // the fire-and-forget open, and the actual resend of a recovered
      // row over the real transport.
      expect(code).toMatch(/const turnOutboxOwner = createTurnOutboxOwner\(\{/);
      expect(code).toMatch(/void turnOutboxOwner\.open\(\);/);
      expect(code).toMatch(
        /const resumePendingTurnOutboxEntries = async \(\): Promise<void> => \{/,
      );
      expect(code).toMatch(/const candidates = await outbox\.getAutoResendCandidates\(\);/);
      expect(code).toMatch(
        /const result = await startDaemonTurn\(entry\.sessionId, text, getTurnTransport\(\)\);/,
      );
      // Never a silent resend of an ambiguous row: only "pending"
      // candidates (`getAutoResendCandidates()`'s own contract already
      // excludes `"awaiting-confirmation"`) are ever touched here.
      expect(code).toMatch(/turnOutboxOwner\.dispose\(\)/);
      expect(code).toMatch(/turnOutbox: turnOutboxOwner,/);
    });

    it("the session route also constructs no OutboxController and calls recoverInFlightTurns nowhere", () => {
      const code = readCode(SESSION_ROUTE_TSX);
      expect(code).not.toMatch(/recoverInFlightTurns/);
      expect(code).not.toMatch(/OutboxController/);
    });

    it("the real blocker is a real one: expo-sqlite is not installed, so there is no SqliteDriver to construct the mount with", () => {
      const wholeSrc = readSource("../../src/platform/offline/sqlite-driver.ts");
      expect(wholeSrc).toMatch(
        /`expo-sqlite` is not an installed dependency of `apps\/android` today/,
      );
    });
  });

  // T72: every case above proves real source matches
  // `background-kill-restore-contract.ts`'s hand-typed restatement — it
  // never opens `background-kill-restore.yaml` itself. That is the same
  // gap that let `composer-inputs.yaml` drift into asserting
  // `text: "Sent"` (see `composer-inputs.contract.test.ts`'s header
  // comment); this flow's PREMISE 1 depends on the identical
  // `entryStatusLabel("failed")` premise and was equally exposed. This
  // block closes that gap using the same shared parser
  // (`./maestro-yaml.ts`).
  describe("background-kill-restore.yaml itself, read from disk", () => {
    const BACKGROUND_KILL_RESTORE_YAML = "../../maestro/background-kill-restore.yaml";
    const yamlText = readSource(BACKGROUND_KILL_RESTORE_YAML);
    const steps = parseMaestroSteps(yamlText);

    it(
      'the first send (PREMISE 1, before background/kill) asserts entryStatusLabel("failed"), and no send in this ' +
        'flow ever asserts entryStatusLabel("sent") — the exact drift T32S13 caused in composer-inputs.yaml, checked ' +
        "here too since this flow shares the identical unpaired-send premise",
      () => {
        const failedLabel = entryStatusLabel("failed");
        const sentLabel = entryStatusLabel("sent");
        const perSend = assertVisibleTextsAfterEachTap(
          steps,
          BACKGROUND_KILL_RESTORE_FLOW.composerSendButton,
        );
        expect(
          perSend.length,
          `background-kill-restore.yaml should tap id="${BACKGROUND_KILL_RESTORE_FLOW.composerSendButton}" at least once`,
        ).toBeGreaterThanOrEqual(1);
        expect(
          perSend[0],
          `background-kill-restore.yaml: the first send's assertVisible steps should include entryStatusLabel("failed") ("${failedLabel}")`,
        ).toContain(failedLabel);
        for (const [index, texts] of perSend.entries()) {
          expect(
            texts,
            `background-kill-restore.yaml: send #${index + 1} (tapOn "${BACKGROUND_KILL_RESTORE_FLOW.composerSendButton}") ` +
              `asserts entryStatusLabel("sent") ("${sentLabel}") — a state this unpaired flow cannot reach`,
          ).not.toContain(sentLabel);
        }
      },
    );

    it("asserts the entered text is gone (not preserved/recovered) after the kill+restore, by the flow's own assertNotVisible", () => {
      // PREMISE 2/3: composer state is not persisted. Reads the real
      // `assertNotVisible` steps rather than re-typing a duplicate claim.
      const lines = yamlText.split(/\r?\n/);
      const restoreIndex = lines.findIndex((line) => line.includes("clearState: false"));
      expect(
        restoreIndex,
        "background-kill-restore.yaml should relaunch with clearState: false after the kill",
      ).toBeGreaterThan(-1);
      const afterRestore = lines.slice(restoreIndex).join("\n");
      expect(afterRestore).toMatch(
        /assertNotVisible:\s*\n\s*text: "Testing background-kill-restore during a turn"/,
      );
      expect(afterRestore).toMatch(/assertNotVisible:\s*\n\s*text: "Failed"/);
    });

    it("never names the production daemon's port, in any form including comments", () => {
      expect(
        yamlText.includes(String(PRODUCTION_DAEMON_PORT)),
        `background-kill-restore.yaml must never name the production daemon port ${PRODUCTION_DAEMON_PORT}, in any form`,
      ).toBe(false);
    });
  });
});
