import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { entryStatusLabel } from "../../src/features/composer/composer-model.js";
import { describePermissionRecovery } from "../../src/features/composer/permission-recovery.js";
import { COMPOSER_INPUTS_FLOW } from "./composer-inputs-contract.js";
import { PRODUCTION_DAEMON_PORT } from "../harness/production-daemon-port.js";
import { assertVisibleTextsAfterEachTap, parseMaestroSteps } from "./maestro-yaml.js";

/**
 * T37E3 — proves every testId/string `../../maestro/composer-inputs.yaml`
 * names still exists in the real source it targets, and that the
 * "keyboard is the only live input mode" claim in that flow's header
 * comment is actually true today. Same rationale and precedent as
 * `pairing.contract.test.ts` (T37E1) and
 * `cold-start-restore-model.test.ts` (T37E2): there is no emulator,
 * device, or Maestro binary in this wave, so this file is the flow's
 * only proof of life.
 *
 * Two proof strategies, chosen per module (identical split to
 * `pairing.contract.test.ts`):
 *
 * - `composer-model.ts` and `permission-recovery.ts` are RN-free, so
 *   this file imports them directly and calls the real functions.
 * - `Composer.tsx`, `session/[agentId]/index.tsx`, `deep-link-routing.ts`
 *   (this last one is RN-free too, but read as text alongside its
 *   siblings for one consistent anchoring style), and `app.config.ts`
 *   are read with `readCode()` (comment-stripped) and matched against a
 *   full JSX/statement expression — never a bare identifier (CLAUDE.md's
 *   "SOURCE-TEXT REGEX TESTS ARE ON PROBATION" note). `readComponentCode`
 *   further anchors each assertion to the specific top-level function it
 *   names, closing defect (5) from that note (a sibling occurrence of
 *   the same call satisfying a whole-file `toMatch`) — `Composer.tsx`
 *   declares three top-level functions (`Composer`, `ComposerEntryRow`,
 *   `StagedAttachmentRow`) and this file is careful to match each
 *   assertion against the one that actually owns it.
 *
 * This file deliberately never asserts that `features/voice` or
 * `features/share` are *unimported* — CLAUDE.md's standing rule against
 * a negative assertion that "pins an unfinished thing shut" applies
 * exactly here: those barrels not being mounted yet is a fact about
 * `T32S12`'s and the native-module task's unfinished work, not a
 * regression this suite should fail the moment either lands. Instead it
 * positively asserts what each barrel's own unavailable-port
 * implementation actually does today (still honest, still a safe
 * default) — see the "blocked modes stay honest" describe block below.
 *
 * Mutation-checked (see the wave report for the exact mutations, their
 * failures, and the byte-identical restores, `diff`-verified): the
 * mic-button testId assertion, the deep-link "session" match branch, and
 * the plain-send-has-no-outbox-dependency branch.
 *
 * T72 adds one more thing this file never did before: it actually opens
 * `../../maestro/composer-inputs.yaml` and parses its real steps
 * (`./maestro-yaml.ts`), instead of only comparing real source against
 * `composer-inputs-contract.ts`'s hand-typed restatement. That
 * restatement is exactly how the yaml drifted into asserting
 * `text: "Sent"` after T32S13 wired `onSubmit` to a real
 * `AppCore.startTurn` (an unpaired send now settles `{ status: "failed"
 * }`) — every check in this file stayed green throughout, because none
 * of them ever read the yaml. See the "composer-inputs.yaml itself,
 * read from disk" describe block below, and its own mutation record.
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

describe("composer-inputs.yaml anchors exist in source", () => {
  describe("the session route deep link this flow opens (bypasses the pairing-navigation gap)", () => {
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

    // P5-W18 merge gate: this assertion used to pin
    // `turnService={NO_OP_TURN_SERVICE}` — a second, older copy of the
    // very negative pin the wave brief named, on the identical construct
    // `session/[agentId]/index.test.ts` correctly retired. T63 built the
    // real `TurnService` and T32S12 mounted it, so the pin is updated to
    // the value the route actually passes now
    // (`useAppCore().createTurnService(agentId)`, memoized).
    //
    // T32S13 (P5-W19) falsified this block a second time: `onSubmit`
    // used to be a fixed `function handleSubmit(_text: string) {}`
    // no-op and `turnRunning` a fixed `false` literal — this flow's own
    // header comment ("keyboard is the only live input mode") was
    // already accurate about *reachability*, but understated what
    // pressing Send actually did. `handleSubmit` is now a local
    // `useCallback` that calls `core.startTurn(agentId, text)` (T32S13,
    // `app-shell/core.ts`), and `turnRunning` is `submitting ||
    // signalRunning` — a local in-flight guard OR'd with T64's real
    // `createTurnRunningSignal` mount (see `session/[agentId]/
    // index.tsx`'s own doc comment for both). `onMicPress`/
    // `onAttachPress` are still local no-ops — voice/attach entry has no
    // production caller yet — so those two assertions are unchanged and
    // stay honest about what this flow can and cannot drive.
    it("SessionRoute mounts Composer with a real turnService, a real onSubmit wired to core.startTurn, and a real turnRunning signal — no pairing needed for keyboard entry", () => {
      const code = readComponentCode(SESSION_ROUTE_TSX, "SessionRoute");
      expect(code).toMatch(
        /<Composer\s+sessionId=\{agentId \?\? ""\}\s+onSubmit=\{handleSubmit\}\s+onMicPress=\{handleMicPress\}\s+onAttachPress=\{handleAttachPress\}\s+turnRunning=\{turnRunning\}\s+turnService=\{turnService\}\s+queueModeClient=\{queueModeClient\}\s+turnStatusClient=\{turnStatusClient\}\s+outbox=\{core\.turnOutbox\.getOutbox\(\) \?\? undefined\}\s*\/>/,
      );
      expect(code).toMatch(
        /const turnService = useMemo\(\(\) => core\.createTurnService\(agentId \?\? ""\), \[core, agentId\]\);/,
      );
      expect(code).toMatch(
        /const handleSubmit = useCallback\(\s*async \(text: string\) => \{\s*setSubmitting\(true\);\s*try \{\s*const result = await core\.startTurn\(agentId \?\? "", text\);/,
      );
      expect(code).toMatch(/const turnRunning = submitting \|\| signalRunning;/);
      const wholeFile = readCode(SESSION_ROUTE_TSX);
      expect(wholeFile).toMatch(/function handleMicPress\(\) \{\}/);
      expect(wholeFile).toMatch(/function handleAttachPress\(\) \{\}/);
      expect(wholeFile).not.toMatch(/function handleSubmit\(_text: string\) \{\}/);
    });

    it('no testId prop is passed to Composer, so it falls back to its own "composer" default', () => {
      const code = readComponentCode(SESSION_ROUTE_TSX, "SessionRoute");
      expect(code).not.toMatch(/<Composer[\s\S]*?testId=/);
    });
  });

  describe("keyboard entry (the only live input mode)", () => {
    it('Composer defaults testId to "composer" and renders that as the Section root testID', () => {
      const code = readComponentCode(COMPOSER_TSX, "Composer");
      expect(code).toMatch(/const composerTestId = testId \?\? "composer";/);
      expect(code).toMatch(
        /<Section title=\{COMPOSER_ACCESSIBILITY_LABEL\} testId=\{composerTestId\}>/,
      );
    });

    it("wires PromptBar (the text field + Send button) to composerTestId", () => {
      const code = readComponentCode(COMPOSER_TSX, "Composer");
      expect(code).toMatch(
        /<PromptBar\s+label=\{COMPOSER_INPUT_LABEL\}[\s\S]{0,400}?testId=\{composerTestId\}\s*\/>/,
      );
    });

    // T75: a plain send used to bypass `sendWithOutbox`/the real
    // `OutboxController` entirely (gated on `attachmentsToSend.length >
    // 0`) and settle straight through a local `Promise.resolve().then(()
    // => onSubmit(...))` chain. Every send — text-only included — now
    // reaches `sendWithOutbox`, which itself calls `onSubmit` and
    // `markEntrySent`/`markEntryFailed` around the real outbox lifecycle.
    it("a plain send (no attachments) reaches the real OutboxController via sendWithOutbox, which awaits onSubmit and reconciles to markEntrySent/markEntryFailed", () => {
      const code = readComponentCode(COMPOSER_TSX, "Composer");
      expect(code).toMatch(
        /const handleSend = useCallback\(\(\) => \{[\s\S]*?void sendWithOutbox\(entry\.id, entry\.text, attachmentsToSend\);\s*\}, \[state, generateId, sendWithOutbox\]\);/,
      );
      expect(code).toMatch(
        /const sendWithOutbox = useCallback\(\s*async \([\s\S]*?await onSubmit\(text\);\s*await outbox\.markSent\(outboxEntry\.id\);[\s\S]*?setState\(\(current\) => markEntrySent\(current, entryId\)\);/,
      );
      expect(code).toMatch(
        /setState\(\(current\) => markEntryFailed\(current, entryId\)\);\s*\}\s*\},\s*\[outbox, resolvedSessionId, onSubmit\],\s*\);/,
      );
    });

    it('entryStatusLabel("sent") is exactly the chip text a resolved send shows', () => {
      expect(entryStatusLabel("sent")).toBe(COMPOSER_INPUTS_FLOW.entrySentLabel);
    });

    // P5-W19 merge gate: T32S13 wired `onSubmit` to `AppCore.startTurn`,
    // so an unpaired run's send reconciles to "Failed", not "Sent" — the
    // flow's own assertion was corrected to match, and this keeps that
    // restatement honest.
    it('entryStatusLabel("failed") is exactly the chip text the unpaired flow asserts, and is distinct from the sent label', () => {
      expect(entryStatusLabel("failed")).toBe(COMPOSER_INPUTS_FLOW.entryFailedLabel);
      expect(COMPOSER_INPUTS_FLOW.entryFailedLabel).not.toBe(COMPOSER_INPUTS_FLOW.entrySentLabel);
    });

    it("the entries container and each row's status Chip carry the testIds/label the flow reads", () => {
      const composer = readComponentCode(COMPOSER_TSX, "Composer");
      expect(composer).toMatch(
        /<View\s+style=\{styles\.entries\}\s+accessibilityRole="none"\s+accessibilityLiveRegion="polite"\s+testID=\{`\$\{composerTestId\}-entries`\}\s*>/,
      );
      const entryRow = readComponentCode(COMPOSER_TSX, "ComposerEntryRow");
      expect(entryRow).toMatch(
        /<Chip label=\{entryStatusLabel\(entry\.status\)\} tone=\{TONE_BY_STATUS\[entry\.status\]\} \/>/,
      );
    });
  });

  describe("mic and attach buttons are live and honest, but the capture/pick they gate is blocked", () => {
    it('the mic ComposerIconAction carries testId="${composerTestId}-mic"', () => {
      const code = readComponentCode(COMPOSER_TSX, "Composer");
      expect(code).toMatch(
        /<ComposerIconAction\s+glyph=\{"\\u\{1F3A4\}"\}\s+accessibleName=\{MIC_ACTION_LABEL\}\s+onPress=\{handleMicPress\}\s+testId=\{`\$\{composerTestId\}-mic`\}\s*\/>/,
      );
    });

    it('the attach ComposerIconAction carries testId="${composerTestId}-attach"', () => {
      const code = readComponentCode(COMPOSER_TSX, "Composer");
      expect(code).toMatch(
        /<ComposerIconAction\s+glyph=\{"\\u\{1F4CE\}"\}\s+accessibleName=\{ATTACH_ACTION_LABEL\}\s+onPress=\{handleAttachPress\}\s+testId=\{`\$\{composerTestId\}-attach`\}\s*\/>/,
      );
    });

    it("both permission notices are mounted under the testIds the flow asserts, kind=photos / kind=microphone", () => {
      const code = readComponentCode(COMPOSER_TSX, "Composer");
      expect(code).toMatch(
        /<PermissionRecoveryNotice\s+kind="photos"[\s\S]{0,300}?testId=\{`\$\{composerTestId\}-attachment-permission-notice`\}/,
      );
      expect(code).toMatch(
        /<PermissionRecoveryNotice\s+kind="microphone"[\s\S]{0,300}?testId=\{`\$\{composerTestId\}-mic-permission-notice`\}/,
      );
    });

    it('describePermissionRecovery(kind, "unavailable") is exactly the banner text the flow asserts for both', () => {
      const photos = describePermissionRecovery("photos", "unavailable");
      expect(`${photos.title}. ${photos.message}`).toBe(
        COMPOSER_INPUTS_FLOW.attachmentUnavailableBannerText,
      );
      const mic = describePermissionRecovery("microphone", "unavailable");
      expect(`${mic.title}. ${mic.message}`).toBe(COMPOSER_INPUTS_FLOW.micUnavailableBannerText);
    });

    it("the default, only-installed port for attachments is the unavailable one (no picker package installed)", () => {
      const attachmentPort = readCode("../../src/features/composer/attachment-source-port.ts");
      expect(attachmentPort).toMatch(
        /export function createUnavailableAttachmentSourcePort\(\): AttachmentSourcePort \{/,
      );
    });
  });

  describe("blocked modes stay honest (voice recording, real attachment picking, share intent) — not exercised by this flow", () => {
    // T94: mic permission itself is resolved through `VoiceCapturePort`
    // alone (T83 collapsed the double OS-prompt bug onto this one port;
    // the standalone `mic-permission-port.ts`/`MicPermissionPort` module
    // it replaced had zero production consumers and was deleted).
    //
    // CORRECTED (P6-W5 merge gate): T94's version of this comment said
    // "this single assertion covers both claims" and widened the title
    // to promise that the mic button "never reaches a second, separate
    // mic-permission port". The body below is one `toMatch` against
    // `voice-capture-port.ts`; it cannot see `Composer.tsx` at all, so
    // it never proved that half. Proof of a claim you did not make is
    // better than a claim you did not prove — so the title is narrowed
    // to what this really checks. The negative half IS proven, and was
    // before T94: `../../src/features/composer/attachment-wiring.test.ts`'s
    // "never resolves mic permission through a second, separate
    // MicPermissionPort" asserts `not.toMatch(/MicPermissionPort/)` and
    // `not.toMatch(/resolvedMicPermission/)` against `Composer.tsx`'s
    // own top-level function, and its own comment records the
    // reintroduce-and-revert mutation that confirmed it bites.
    it("features/voice's only production capture port is the unavailable one (no expo-audio installed)", () => {
      const code = readCode("../../src/features/voice/voice-capture-port.ts");
      expect(code).toMatch(/export function createUnavailableVoiceCapturePort\(\)/);
    });

    it("features/share's only production intent port is the unavailable one; there is no live receiver to send an intent to", () => {
      const code = readCode("../../src/features/share/share-intent-port.ts");
      expect(code).toMatch(/export function createUnavailableShareIntentPort\(\)/);
    });
  });

  // T72: everything above proves real source matches
  // `composer-inputs-contract.ts`'s hand-typed restatement of the yaml.
  // Nothing above ever opens `composer-inputs.yaml` itself — which is
  // exactly the gap that let it drift into asserting `text: "Sent"`
  // after T32S13 destroyed that premise (see this file's own header
  // comment). This block closes that gap by parsing the yaml's actual
  // steps (`./maestro-yaml.ts`) and checking them against the same real
  // functions the rest of this file already proves are honest.
  describe("composer-inputs.yaml itself, read from disk", () => {
    const COMPOSER_INPUTS_YAML = "../../maestro/composer-inputs.yaml";
    const yamlText = readSource(COMPOSER_INPUTS_YAML);
    const steps = parseMaestroSteps(yamlText);

    it(
      'asserts entryStatusLabel("failed") after tapping composer-send, and never entryStatusLabel("sent") — the exact ' +
        "drift T32S13 caused and the P5-W19 merge gate corrected by hand in this file",
      () => {
        const failedLabel = entryStatusLabel("failed");
        const sentLabel = entryStatusLabel("sent");
        const perSend = assertVisibleTextsAfterEachTap(
          steps,
          COMPOSER_INPUTS_FLOW.composerSendButton,
        );
        expect(
          perSend,
          `composer-inputs.yaml should tap id="${COMPOSER_INPUTS_FLOW.composerSendButton}" exactly once`,
        ).toHaveLength(1);
        const texts = perSend[0] ?? [];
        expect(
          texts,
          `composer-inputs.yaml: no assertVisible step after tapping "${COMPOSER_INPUTS_FLOW.composerSendButton}" ` +
            `asserts entryStatusLabel("failed") ("${failedLabel}") — the only status an unpaired send can reach`,
        ).toContain(failedLabel);
        expect(
          texts,
          `composer-inputs.yaml: an assertVisible step after tapping "${COMPOSER_INPUTS_FLOW.composerSendButton}" ` +
            `asserts entryStatusLabel("sent") ("${sentLabel}") — a state this unpaired flow's own Composer.tsx/core.ts ` +
            'wiring cannot reach (see this file\'s "PREMISE"/header comments)',
        ).not.toContain(sentLabel);
      },
    );

    it("asserts the mic/attach 'unavailable' banner copy exactly as describePermissionRecovery renders it today", () => {
      const assertedTexts = steps
        .filter((step) => step.kind === "assertVisible" && step.text !== undefined)
        .map((step) => step.text as string);
      const mic = describePermissionRecovery("microphone", "unavailable");
      const photos = describePermissionRecovery("photos", "unavailable");
      expect(
        assertedTexts,
        'composer-inputs.yaml should assert describePermissionRecovery("microphone", "unavailable")\'s real copy',
      ).toContain(`${mic.title}. ${mic.message}`);
      expect(
        assertedTexts,
        'composer-inputs.yaml should assert describePermissionRecovery("photos", "unavailable")\'s real copy',
      ).toContain(`${photos.title}. ${photos.message}`);
    });

    it("taps/asserts the entries container, composer-mic and composer-attach ids exactly as Composer.tsx names them", () => {
      // composer-mic/composer-attach are TAPPED (`tapOn`), not asserted
      // visible by id — only their permission notices are asserted
      // visible — so this reads ids off every step kind, not just
      // `assertVisible`.
      const ids = steps.filter((step) => step.id !== undefined).map((step) => step.id as string);
      expect(ids).toContain(COMPOSER_INPUTS_FLOW.composerRoot);
      expect(ids).toContain(COMPOSER_INPUTS_FLOW.composerEntriesContainer);
      expect(ids).toContain(COMPOSER_INPUTS_FLOW.composerMicButton);
      expect(ids).toContain(COMPOSER_INPUTS_FLOW.composerAttachButton);
      expect(ids).toContain(COMPOSER_INPUTS_FLOW.composerAttachmentPermissionNotice);
      expect(ids).toContain(COMPOSER_INPUTS_FLOW.composerMicPermissionNotice);
    });

    it("never names the production daemon's port, in any form including comments", () => {
      expect(
        yamlText.includes(String(PRODUCTION_DAEMON_PORT)),
        `composer-inputs.yaml must never name the production daemon port ${PRODUCTION_DAEMON_PORT}, in any form ` +
          "(this flow's own header already says it talks to no daemon at all)",
      ).toBe(false);
    });
  });
});
