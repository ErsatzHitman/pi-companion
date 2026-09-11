import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ATTACH_ACTION_LABEL,
  COMPOSER_INPUT_LABEL,
  entryStatusLabel,
  MIC_ACTION_LABEL,
} from "../../src/features/composer/composer-model.js";
import {
  NEW_PROFILE_ID,
  validateConnectForm,
} from "../../src/features/connect/connect-form-model.js";
import { settingsHostAccessibilityLabel } from "../../src/features/settings/settings-host-model.js";
import { ACCESSIBILITY_AUDIT_FLOW } from "./accessibility-audit-contract.js";
import { PRODUCTION_DAEMON_PORT } from "../harness/production-daemon-port.js";
import { assertVisibleTextsAfterEachTap, parseMaestroSteps } from "./maestro-yaml.js";

/**
 * T37E10 — proves every testId/string `../../maestro/accessibility-audit.yaml`
 * names still exists in the real source it targets, and that the 48dp
 * touch-target and TalkBack-label claims that flow makes are backed by
 * real, declared style/accessibility props — not merely by a control
 * being visible. Same rationale and precedent as every sibling
 * `*.contract.test.ts` (`pairing.contract.test.ts`,
 * `composer-inputs.contract.test.ts`, `extension-sheets.contract.test.ts`,
 * `notification-approval.contract.test.ts`): there is no emulator,
 * device, or Maestro binary in this wave (`../README.md`'s "What T37D
 * proved, and what it did not"), so this file is the flow's only proof
 * of life.
 *
 * Two proof strategies, chosen per module (identical split to every
 * sibling contract test):
 *
 * - `composer-model.ts` and `connect-form-model.ts` are RN-free, so this
 *   file imports them directly and calls the real functions.
 * - `Composer.tsx`, `composer-icon-action.tsx`, `Button.tsx`,
 *   `TextField.tsx`, `OnboardingGate.tsx`, `ConnectForm.tsx`,
 *   `connect.tsx`, `session/[agentId]/index.tsx`, and the files-screen
 *   route reach `react-native` and cannot be imported here, so those are
 *   read with `readCode()` (comment-stripped) and matched against a full
 *   JSX/style-object expression — never a bare identifier
 *   (`CLAUDE.md`'s "SOURCE-TEXT REGEX TESTS ARE ON PROBATION" note).
 *   `readComponentCode` further anchors each assertion to the one
 *   top-level function that owns it, closing defect (5) (a sibling
 *   occurrence of the same call satisfying a whole-file `toMatch`) —
 *   several of these files declare more than one top-level function
 *   (`Composer.tsx` alone has three).
 *
 * A real render/TalkBack pass on a device would check two things this
 * file checks statically instead:
 *   1. **48dp touch target** — a `Pressable`/`TextInput`'s own resolved
 *      style declares `minHeight`/`minWidth` >= 48 (the "48dp touch targets"
 *      describe block below), the same per-element contract
 *      `ui/primitives/touch-targets.test.ts` (T26A/T57B, extended to
 *      take a path per entry by T81) already proves for `Button`,
 *      `TextField`, and (as of T81) `composer-icon-action.tsx` itself —
 *      this file does not re-derive that proof, it points at the same
 *      source those primitives declare.
 *   2. **TalkBack label** — the control's `accessibilityLabel` is
 *      exactly the string `accessibility-audit.yaml` asserts as visible
 *      Maestro `text:` output. On Android, Maestro's driver matches a
 *      `text:` selector against an element's visible text **or** its
 *      `content-desc` (which is what an RN `accessibilityLabel` compiles
 *      to) — for `composer-mic`/`composer-attach`, whose glyph is
 *      `accessibilityElementsHidden`, the asserted string exists in the
 *      UI tree *only* as content-desc, so a passing run genuinely proves
 *      the TalkBack name, not a coincidental match against visible text.
 *      This file cannot prove Maestro's matching behaviour itself (no
 *      Maestro binary this wave — see the flow's own header comment);
 *      what it proves is that the source really does wire that exact
 *      string as `accessibilityLabel` on that exact control.
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
 * Every `ACCESSIBILITY_AUDIT_FLOW` value that is a testID rather than an
 * announced label or a deep link, read from the real contract object so
 * the list cannot drift from it (T193).
 *
 * The shape test is the classification: a testID in this repository is
 * lower-case kebab (`live-screen-back`), an announced label is prose
 * starting with a capital (`"Back to session"`), and a deep link carries
 * `://`. The caller asserts a floor on the result's size, so a future
 * value shape that slipped past this filter shows up as a failure here
 * rather than as a quietly empty set — the "check that cannot fail"
 * shape `CLAUDE.md` warns about.
 */
function auditedControlTestIds(): string[] {
  // Widened to `string[]` on the way in: `Object.values` of an `as
  // const` object is a union of its literals, which a `value is string`
  // predicate cannot narrow (TS2677).
  const values: string[] = Object.values(ACCESSIBILITY_AUDIT_FLOW);
  return values.filter((value) => /^[a-z][a-z0-9-]*$/.test(value));
}

interface TalkbackTableRow {
  readonly control: string;
  readonly ids: readonly string[];
  readonly line: string;
}

/**
 * `docs/accessibility-talkback-procedure.md`'s Part 1 table, parsed into
 * its rows. Only the second cell (`testID`) is scanned for ids, so the
 * backticked file names in the other cells cannot be mistaken for
 * controls.
 */
function talkbackProcedureRows(): TalkbackTableRow[] {
  const md = readSource(TALKBACK_PROCEDURE_MD);
  const start = md.indexOf("| Screen / control");
  expect(start, `${TALKBACK_PROCEDURE_MD} should carry a Part 1 table`).toBeGreaterThan(-1);
  const end = md.indexOf("\n\n", start);
  expect(end, `${TALKBACK_PROCEDURE_MD}'s Part 1 table should end in a blank line`).toBeGreaterThan(
    start,
  );
  return md
    .slice(start, end)
    .split("\n")
    .slice(2) // the header row and its `| --- |` separator
    .filter((line) => line.startsWith("|"))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      return {
        control: cells[1] ?? "",
        ids: [...(cells[2] ?? "").matchAll(/`([a-z][a-z0-9-]*)`/g)].map((match) => match[1]),
        line,
      };
    });
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

const BUTTON_TSX = "../../src/ui/primitives/Button.tsx";
const TEXT_FIELD_TSX = "../../src/ui/primitives/TextField.tsx";
const TOUCH_TARGETS_TEST_TS = "../../src/ui/primitives/touch-targets.test.ts";
const ICON_ACTION_TSX = "../../src/features/composer/composer-icon-action.tsx";
const CONNECT_TSX = "../../src/app/connect.tsx";
const ONBOARDING_GATE_TSX = "../../src/features/connect/OnboardingGate.tsx";
const CONNECT_FORM_TSX = "../../src/features/connect/ConnectForm.tsx";
const CONNECTION_SHELL_TSX = "../../src/features/connect/connection-shell.tsx";
const COMPOSER_TSX = "../../src/features/composer/Composer.tsx";
const SESSION_ROUTE_TSX = "../../src/app/h/[serverId]/session/[agentId]/index.tsx";
const FILES_ROUTE_TSX = "../../src/app/h/[serverId]/session/[agentId]/files/[...path].tsx";
const FILES_SCREEN_TSX = "../../src/features/files/files-screen.tsx";
const SHARE_ROUTE_TSX = "../../src/app/share.tsx";
const SCREEN_BAR_TSX = "../../src/ui/recipes/ScreenBar.tsx";
const LIVE_SCREEN_TSX = "../../src/features/live/live-screen.tsx";
const LIVE_ROUTE_TSX = "../../src/app/h/[serverId]/session/[agentId]/live.tsx";
const SESSION_NAV_ACTIONS_TSX = "../../src/app-shell/session-nav-actions.tsx";
const SETTINGS_SCREEN_TSX = "../../src/features/settings/SettingsScreen.tsx";
const TOGGLE_TSX = "../../src/ui/primitives/Toggle.tsx";
const TALKBACK_PROCEDURE_MD = "../../../../docs/accessibility-talkback-procedure.md";

describe("accessibility-audit.yaml anchors exist in source", () => {
  describe("48dp touch targets — declared once per control, inherited by every screen this flow samples", () => {
    it("Button.tsx's Pressable touchArea is minHeight: 48 — every onboarding/connect-form/composer-send control below renders through this primitive", () => {
      const code = readCode(BUTTON_TSX);
      expect(code).toMatch(
        /touchArea: \{ minHeight: 48, justifyContent: "center", alignItems: "flex-start" \}/,
      );
      expect(code).toMatch(/style=\{styles\.touchArea\}/);
    });

    it("TextField.tsx's TextInput style declares minHeight: 48 — inherited by the connect form's address field", () => {
      const code = readCode(TEXT_FIELD_TSX);
      expect(code).toMatch(/input: \{\s*minHeight: 48,/);
      expect(code).toMatch(/style=\{\[styles\.input, error \? styles\.inputError : null\]\}/);
    });

    it("PromptBar.tsx's TextInput style declares minHeight: 48 — inherited by the composer's message field", () => {
      const code = readCode("../../src/ui/recipes/PromptBar.tsx");
      expect(code).toMatch(/input: \{\s*minHeight: 48,/);
    });

    it("T81 closed the gap this test used to document: touch-targets.test.ts now audits composer-icon-action.tsx (mic/attach) by path, even though the file lives outside ui/primitives/", () => {
      // touch-targets.test.ts (T26A/T57B) used to read only
      // `./${name}.tsx`, relative to its own directory
      // (ui/primitives/), so a component outside that directory could
      // never join CRITICAL_INTERACTIVE_PRIMITIVES — this file's own
      // "the one gap ..." test used to pin that absence shut. T81
      // (P5-W21) changed the loop to take a path per entry and added
      // ComposerIconAction pointing at composer-icon-action.tsx; this
      // now proves the fix's presence instead of the old gap's absence.
      const suite = readCode(TOUCH_TARGETS_TEST_TS);
      expect(suite).toMatch(/name: "ComposerIconAction"/);
      expect(suite).toMatch(/path: "\.\.\/\.\.\/features\/composer\/composer-icon-action\.tsx"/);
      const list =
        /const CRITICAL_INTERACTIVE_PRIMITIVES: AuditedComponent\[\] = (\[[\s\S]*?\]);/.exec(
          suite,
        )?.[1];
      expect(list).toBeDefined();
      expect(list).toMatch(/name: "ComposerIconAction"/);

      const iconAction = readCode(ICON_ACTION_TSX);
      expect(iconAction).toMatch(/touchArea: \{\s*minWidth: 48,\s*minHeight: 48,/);
      expect(iconAction).toMatch(/style=\{\(\{ pressed \}\) => \[styles\.touchArea/);
    });
  });

  describe("onboarding (OnboardingGate.tsx, mounted by connect.tsx)", () => {
    it('connect.tsx mounts OnboardingGate under testId="connect-onboarding"', () => {
      const code = readComponentCode(CONNECT_TSX, "ConnectRoute");
      expect(code).toMatch(
        /<OnboardingGate storage=\{core\.keyValueStorage\} testId="connect-onboarding">/,
      );
    });

    it('the welcome step renders a real <Button label="Get started"> under `${testId}-welcome-continue`', () => {
      const code = readComponentCode(ONBOARDING_GATE_TSX, "OnboardingGate");
      expect(code).toMatch(
        /<Button\s+kind="primary"\s+label="Get started"\s+onPress=\{\(\) => void controller\.advance\(\)\}\s+testId=\{testId \? `\$\{testId\}-welcome-continue` : undefined\}/,
      );
    });

    it('the permissions step renders a real <Button label="Continue"> under `${testId}-permission-continue`', () => {
      const code = readComponentCode(ONBOARDING_GATE_TSX, "OnboardingGate");
      expect(code).toMatch(
        /<Button\s+kind="primary"\s+label="Continue"\s+onPress=\{\(\) => void controller\.complete\(\)\}\s+testId=\{testId \? `\$\{testId\}-permission-continue` : undefined\}/,
      );
    });
  });

  describe("connect form (ConnectForm.tsx, mounted by connection-shell.tsx)", () => {
    it('connection-shell.tsx mounts ConnectForm under testId="connect-form"', () => {
      const code = readCode(CONNECTION_SHELL_TSX);
      // T32S14 (P5-W20, this same wave) now also passes `profiles` — a
      // saved profile is reconnectable from this same form's "existing"
      // mode as of this task; the testId this flow drives is unchanged.
      expect(code).toMatch(
        /<ConnectForm testId="connect-form" onSubmit=\{handleSubmit\} profiles=\{profileOptions\} \/>/,
      );
    });

    it('the address field is a real <TextField label="Host address" required> under `${testId}-address-field`', () => {
      const code = readComponentCode(CONNECT_FORM_TSX, "ConnectForm");
      // `[\s\S]{0,400}?` skips over the `placeholder="ws://..."` value
      // rather than spelling it literally — `readCode()`'s line-comment
      // stripper (`replace(/\/\/.*$/gm, "")`) does not know a `//` sits
      // inside a string, so it truncates the rest of that line; this is
      // the same wildcard-skip precedent `pairing.contract.test.ts` uses
      // for the identical `ws://` literal.
      expect(code).toMatch(
        /<TextField\s+label="Host address"\s+value=\{address\}\s+onChangeText=\{handleAddressChange\}[\s\S]{0,400}?error=\{errors\.address\}\s+required/,
      );
      expect(code).toMatch(/testId=\{testId \? `\$\{testId\}-address-field` : undefined\}/);
    });

    it("TextField.tsx folds a field error into its own accessibilityLabel as `${label}. ${error}` — the field's accessible name changes when the error state does", () => {
      const code = readCode(TEXT_FIELD_TSX);
      expect(code).toMatch(/accessibilityLabel=\{error \? `\$\{label\}\. \$\{error\}` : label\}/);
    });

    it('the submit button is a real <Button label={isNewProfile ? "Add host" : "Use this profile"}> under `${testId}-submit-button`, "Add host" on a fresh install', () => {
      const code = readComponentCode(CONNECT_FORM_TSX, "ConnectForm");
      expect(code).toMatch(
        /<Button\s+kind="primary"\s+label=\{isNewProfile \? "Add host" : "Use this profile"\}\s+onPress=\{handleSubmit\}\s+testId=\{testId \? `\$\{testId\}-submit-button` : undefined\}/,
      );
      expect(code).toMatch(
        /const \[profileId, setProfileId\] = useState<string>\(NEW_PROFILE_ID\);/,
      );
    });

    it('validateConnectForm({ address: "" }) really produces ACCESSIBILITY_AUDIT_FLOW.connectFormEmptyAddressError — the same error this flow submits an empty form to trigger', () => {
      const result = validateConnectForm(
        { profileId: NEW_PROFILE_ID, profileName: "", address: "" },
        [],
      );
      expect(result.ok).toBe(false);
      expect(!result.ok && result.errors.address).toBe(
        ACCESSIBILITY_AUDIT_FLOW.connectFormEmptyAddressError,
      );
    });
  });

  describe("composer (Composer.tsx, reached via the same deep link composer-inputs.yaml/T37E3 established)", () => {
    it("SessionRoute mounts Composer with onMicPress/onAttachPress still wired to local no-ops — real capture/picking stay unmounted, matching composer-inputs.yaml's own disclosure; this flow only samples the buttons' touch target and TalkBack label, never a completed capture or pick", () => {
      const code = readComponentCode(SESSION_ROUTE_TSX, "SessionRoute");
      expect(code).toMatch(
        /<Composer\s+sessionId=\{agentId \?\? ""\}\s+onSubmit=\{handleSubmit\}\s+onMicPress=\{handleMicPress\}\s+onAttachPress=\{handleAttachPress\}/,
      );
      const wholeFile = readCode(SESSION_ROUTE_TSX);
      expect(wholeFile).toMatch(/function handleMicPress\(\) \{\}/);
      expect(wholeFile).toMatch(/function handleAttachPress\(\) \{\}/);
    });

    it("Composer renders two real <ComposerIconAction> controls: mic (testId `${composerTestId}-mic`) and attach (`${composerTestId}-attach`)", () => {
      const code = readComponentCode(COMPOSER_TSX, "Composer");
      expect(code).toMatch(
        /<ComposerIconAction\s+glyph=\{"\\u\{1F3A4\}"\}\s+accessibleName=\{MIC_ACTION_LABEL\}\s+onPress=\{handleMicPress\}\s+testId=\{`\$\{composerTestId\}-mic`\}/,
      );
      expect(code).toMatch(
        /<ComposerIconAction\s+glyph=\{"\\u\{1F4CE\}"\}\s+accessibleName=\{ATTACH_ACTION_LABEL\}\s+onPress=\{handleAttachPress\}\s+testId=\{`\$\{composerTestId\}-attach`\}/,
      );
    });

    it("composer-icon-action.tsx wires accessibleName to the Pressable's own accessibilityLabel and hides the glyph from the accessibility tree — the mechanism ACCESSIBILITY_AUDIT_FLOW's mic/attach labels depend on", () => {
      const code = readComponentCode(ICON_ACTION_TSX, "ComposerIconAction");
      expect(code).toMatch(
        /<Pressable\s+accessibilityRole="button"\s+accessibilityLabel=\{accessibleName\}/,
      );
      expect(code).toMatch(
        /<Text\s+accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"/,
      );
    });

    it("MIC_ACTION_LABEL, ATTACH_ACTION_LABEL, and COMPOSER_INPUT_LABEL are exactly the strings this flow asserts as Maestro text: selectors", () => {
      expect(MIC_ACTION_LABEL).toBe(ACCESSIBILITY_AUDIT_FLOW.composerMicLabel);
      expect(ATTACH_ACTION_LABEL).toBe(ACCESSIBILITY_AUDIT_FLOW.composerAttachLabel);
      expect(COMPOSER_INPUT_LABEL).toBe(ACCESSIBILITY_AUDIT_FLOW.composerInputLabel);
    });

    it('PromptBar.tsx labels its TextInput accessibilityLabel={label} and its send Button label="Send"', () => {
      const code = readCode("../../src/ui/recipes/PromptBar.tsx");
      expect(code).toMatch(/accessibilityLabel=\{label\}/);
      expect(code).toMatch(
        /<Button\s+kind="primary"\s+label="Send"\s+disabled=\{!canSend\}\s+onPress=\{onSend\}\s+testId=\{testId \? `\$\{testId\}-send` : undefined\}/,
      );
    });

    it('entryStatusLabel("failed") is exactly "Failed" — the state a keyboard send with no daemon connected reconciles to, and what this flow asserts is announced', () => {
      expect(entryStatusLabel("failed")).toBe(ACCESSIBILITY_AUDIT_FLOW.entryFailedLabel);
    });

    it('the composer entries container carries accessibilityLiveRegion="polite", so TalkBack announces the pending -> failed transition without a re-focus', () => {
      const code = readComponentCode(COMPOSER_TSX, "Composer");
      expect(code).toMatch(
        /<View\s+style=\{styles\.entries\}\s+accessibilityRole="none"\s+accessibilityLiveRegion="polite"\s+testID=\{`\$\{composerTestId\}-entries`\}/,
      );
    });
  });

  describe("blocked/unmounted scenarios — named, not sampled, per this flow's own header comment", () => {
    it("T78 (P5-W22) mounted filePicker/sharing at this exact route, on top of T32S14's fetchImpl — this positive prop-list match went stale in the ordinary, already-established way (see composer-inputs.contract.test.ts's own P5-W18/P5-W19 history) and is updated here, not pinned. SessionFilesRoute now passes a real filePicker, so files-screen.tsx's UploadPanel (T35A4's upload half) renders; the guard itself is unchanged and still short-circuits whenever filePicker is absent.", () => {
      const routeCode = readComponentCode(FILES_ROUTE_TSX, "SessionFilesRoute");
      expect(routeCode).toMatch(
        /<FilesScreen\s+serverId=\{serverId\}\s+agentId=\{agentId\}\s+path=\{path \?\? \[\]\}\s+workspaceRoot=""\s+client=\{core\.fileBrowserClient\}\s+filePicker=\{core\.filePicker\}\s+sharing=\{core\.sharing\}\s+downloadOrigin=\{downloadOrigin\}\s+connectionPath=\{connectionPath\}\s+fetchImpl=\{fetchImpl\}\s*\/>/,
      );

      const screenCode = readCode(FILES_SCREEN_TSX);
      expect(screenCode).toMatch(
        /const uploadController = useMemo\(\(\) => \{\s*if \(!client \|\| !filePicker\) return null;/,
      );
    });

    it("T69 (P5-W21) mounted the share-intent receiver: /share wraps the real AppCore.shareIntentPort in ShareChooserRuntime and renders ShareChooserScreen — this positive wiring match replaces the prior 'nothing imports the receiver/port yet' pin, which went stale the ordinary way once the thing it described stopped being unfinished (CLAUDE.md's standing rule)", () => {
      const shareBarrel = readSource("../../src/features/share/index.ts");
      expect(shareBarrel).toMatch(/\*\*Mounted as of T69\.\*\*/);

      const routeCode = readCode(SHARE_ROUTE_TSX);
      expect(routeCode).toMatch(/port: core\.shareIntentPort/);
      expect(routeCode).toMatch(
        /import \{\s*ShareChooserScreen,\s*type ShareChooserDestination,\s*\} from "\.\.\/features\/share\/ShareChooserScreen\.js";/,
      );
      expect(routeCode).toMatch(/<ShareChooserScreen/);

      // The one disclosed gap this mount still leaves (filed against
      // T32S15, see /share's own doc comment): nothing yet navigates TO
      // this route automatically from elsewhere in the app. Named here
      // rather than silently dropped, per this describe block's own
      // "named, not sampled" header. Read as prose (readSource, not
      // readCode): the gap is disclosed in the route's own doc comment.
      expect(readSource(SHARE_ROUTE_TSX)).toMatch(/T32S15/);
    });

    it("panel.tsx (T34B4) renders its row actions through a real <Button>, so the same 48dp/label proof above already covers it, but this flow does not sample it live — extension-sheets.yaml (T37E5) already discloses why every Pi UI element kind is unreachable this wave (no navigation to a session without this flow's own deep-link workaround, and no live daemon ever emits a pi_ui_state/pi_ui_delta on this harness's isolated daemon)", () => {
      const panelCode = readCode("../../src/features/extensions/renderers/panel.tsx");
      expect(panelCode).toMatch(/<Button\b/);
      const extensionSheetsFlow = readSource("../../maestro/extension-sheets.yaml");
      expect(extensionSheetsFlow).toMatch(/KNOWN BLOCKERS/);
    });
  });

  describe("A2 Live and A3 Settings (T368) — the two redesigned screens this flow had never reached", () => {
    it("ScreenBar hides its mark from assistive tech and requires an accessibleName, so a bar action can never be announced as its glyph", () => {
      const code = readComponentCode(SCREEN_BAR_TSX, "BarAction");
      // The name comes from the action, not from the visible content.
      expect(code).toMatch(/accessibilityLabel=\{action\.accessibleName\}/);
      // And the visible content is removed from the tree TalkBack reads,
      // both ways Android needs it said.
      expect(code).toMatch(/accessibilityElementsHidden/);
      expect(code).toMatch(/importantForAccessibility="no-hide-descendants"/);
      // `accessibleName` is not optional on the interface — that is what
      // makes the two assertions above a contract rather than a habit.
      const whole = readCode(SCREEN_BAR_TSX);
      expect(whole).toMatch(/accessibleName: string;/);
    });

    it("the bar's 48dp touch area is declared in ScreenBar.tsx itself and audited by the shared touch-target loop", () => {
      const code = readCode(SCREEN_BAR_TSX);
      expect(code).toMatch(/touchArea: \{[^}]*minHeight: 48/);
      expect(code).toMatch(/touchArea: \{[^}]*minWidth: 48/);
      // Pointed at, not re-derived here — the same split every other
      // control in this file uses.
      expect(readSource(TOUCH_TARGETS_TEST_TS)).toMatch(/ScreenBar/);
    });

    it("live-screen.tsx names the back action and the run pill exactly as the yaml asserts them", () => {
      const code = readComponentCode(LIVE_SCREEN_TSX, "LiveScreen");
      expect(code).toMatch(
        new RegExp(`accessibleName: "${ACCESSIBILITY_AUDIT_FLOW.liveBackLabel}"`),
      );
      expect(code).toMatch(/testId: `\$\{testId\}-back`/);
      expect(code).toMatch(/label=\{turnRunning \? "Working" : "Idle"\}/);
      expect(code).toMatch(/testId=\{`\$\{testId\}-status`\}/);
      // `live.tsx` passes no `testId`, so the default is what the yaml's
      // ids are built from — checked rather than assumed, because a
      // caller-supplied prefix would silently break every id below.
      expect(readCode(LIVE_SCREEN_TSX)).toMatch(/testId = "live-screen"/);
      expect(readComponentCode(LIVE_ROUTE_TSX, "SessionLiveRoute")).not.toMatch(/testId=/);
    });

    it("Files and Terminal kept their testIDs when HANDOFF §7.4 moved them onto A2, and the route really mounts them there", () => {
      const code = readComponentCode(SESSION_NAV_ACTIONS_TSX, "SessionNavActions");
      expect(code).toMatch(new RegExp(`label="${ACCESSIBILITY_AUDIT_FLOW.liveFilesLabel}"`));
      expect(code).toMatch(new RegExp(`label="${ACCESSIBILITY_AUDIT_FLOW.liveTerminalLabel}"`));
      expect(code).toMatch(/testId=\{`\$\{testId\}-files`\}/);
      expect(code).toMatch(/testId=\{`\$\{testId\}-terminal`\}/);
      expect(readCode(SESSION_NAV_ACTIONS_TSX)).toMatch(/testId = "session-nav-actions"/);
      // The relocation itself: A2's route is what mounts them now.
      expect(readComponentCode(LIVE_ROUTE_TSX, "SessionLiveRoute")).toMatch(
        /navActions=\{<SessionNavActions/,
      );
    });

    it("the settings host row is one accessible element whose whole name settings-host-model.ts builds", () => {
      const code = readComponentCode(SETTINGS_SCREEN_TSX, "SettingsScreen");
      expect(code).toMatch(
        /accessibilityLabel=\{settingsHostAccessibilityLabel\(hostProfile, connectionPhase\)\}/,
      );
      expect(code).toMatch(/testID=\{testId \? `\$\{testId\}-host-row` : undefined\}/);
    });

    it("Toggle announces its visible label, which is what the haptics assertion relies on", () => {
      expect(readCode(TOGGLE_TSX)).toMatch(/accessibilityLabel=\{label\}/);
      expect(readComponentCode(SETTINGS_SCREEN_TSX, "SettingsScreen")).toMatch(
        new RegExp(`label="${ACCESSIBILITY_AUDIT_FLOW.settingsHapticsLabel}"`),
      );
    });
  });

  it("ACCESSIBILITY_AUDIT_FLOW's constants match the literals accessibility-audit.yaml actually uses", () => {
    // accessibility-audit.yaml cannot import this module (Maestro has no
    // module system) — this pins the two copies (constants file, yaml
    // literal) against each other so they cannot silently drift apart
    // unnoticed, matching every sibling contract test's final case.
    expect(ACCESSIBILITY_AUDIT_FLOW.onboardingRoot).toBe("connect-onboarding");
    expect(ACCESSIBILITY_AUDIT_FLOW.onboardingWelcomeContinueButton).toBe(
      "connect-onboarding-welcome-continue",
    );
    expect(ACCESSIBILITY_AUDIT_FLOW.onboardingWelcomeContinueLabel).toBe("Get started");
    expect(ACCESSIBILITY_AUDIT_FLOW.onboardingPermissionContinueButton).toBe(
      "connect-onboarding-permission-continue",
    );
    expect(ACCESSIBILITY_AUDIT_FLOW.onboardingPermissionContinueLabel).toBe("Continue");
    expect(ACCESSIBILITY_AUDIT_FLOW.connectFormSection).toBe("connect-form");
    expect(ACCESSIBILITY_AUDIT_FLOW.connectFormAddressField).toBe("connect-form-address-field");
    expect(ACCESSIBILITY_AUDIT_FLOW.connectFormSubmitButton).toBe("connect-form-submit-button");
    expect(ACCESSIBILITY_AUDIT_FLOW.connectFormSubmitLabel).toBe("Add host");
    expect(ACCESSIBILITY_AUDIT_FLOW.sessionDeepLink).toBe(
      "picompanion://h/e2e-host/session/e2e-session",
    );
    expect(ACCESSIBILITY_AUDIT_FLOW.composerRoot).toBe("composer");
    expect(ACCESSIBILITY_AUDIT_FLOW.composerInputField).toBe("composer-input");
    expect(ACCESSIBILITY_AUDIT_FLOW.composerSendButton).toBe("composer-send");
    expect(ACCESSIBILITY_AUDIT_FLOW.composerSendLabel).toBe("Send");
    expect(ACCESSIBILITY_AUDIT_FLOW.composerEntriesContainer).toBe("composer-entries");
    expect(ACCESSIBILITY_AUDIT_FLOW.composerMicButton).toBe("composer-mic");
    expect(ACCESSIBILITY_AUDIT_FLOW.composerAttachButton).toBe("composer-attach");
    // T368 — A2 and A3.
    expect(ACCESSIBILITY_AUDIT_FLOW.liveDeepLink).toBe(
      "picompanion://h/e2e-host/session/e2e-session/live",
    );
    expect(ACCESSIBILITY_AUDIT_FLOW.liveScreenRoot).toBe("live-screen");
    expect(ACCESSIBILITY_AUDIT_FLOW.liveBackButton).toBe("live-screen-back");
    expect(ACCESSIBILITY_AUDIT_FLOW.liveStatusPill).toBe("live-screen-status");
    expect(ACCESSIBILITY_AUDIT_FLOW.liveFilesButton).toBe("session-nav-actions-files");
    expect(ACCESSIBILITY_AUDIT_FLOW.liveTerminalButton).toBe("session-nav-actions-terminal");
    expect(ACCESSIBILITY_AUDIT_FLOW.settingsDeepLink).toBe("picompanion://h/e2e-host/settings");
    expect(ACCESSIBILITY_AUDIT_FLOW.settingsScreenRoot).toBe("settings-screen");
    expect(ACCESSIBILITY_AUDIT_FLOW.settingsHostRow).toBe("settings-screen-host-row");
    expect(ACCESSIBILITY_AUDIT_FLOW.settingsHapticsToggle).toBe("settings-screen-haptics-toggle");
  });

  // T72: everything above (including the "constants match the literals"
  // case just above) only ever compares real source against
  // `accessibility-audit-contract.ts`'s hand-typed restatement — it
  // never opens `accessibility-audit.yaml` itself. That is the same gap
  // that let `composer-inputs.yaml` drift into asserting `text: "Sent"`
  // (see `composer-inputs.contract.test.ts`'s header comment); this
  // flow asserts the identical `entryStatusLabel("failed")` premise
  // (line 239 of the yaml today) and was equally exposed. This block
  // closes that gap the same way `composer-inputs.contract.test.ts`
  // does, using the same shared parser (`./maestro-yaml.ts`).
  describe("accessibility-audit.yaml itself, read from disk", () => {
    const ACCESSIBILITY_AUDIT_YAML = "../../maestro/accessibility-audit.yaml";
    const yamlText = readSource(ACCESSIBILITY_AUDIT_YAML);
    const steps = parseMaestroSteps(yamlText);

    it(
      'asserts entryStatusLabel("failed") after tapping composer-send, and never entryStatusLabel("sent") — the same ' +
        "unpaired-send premise composer-inputs.yaml (T37E3) shares, proven independently here",
      () => {
        const failedLabel = entryStatusLabel("failed");
        const sentLabel = entryStatusLabel("sent");
        const perSend = assertVisibleTextsAfterEachTap(
          steps,
          ACCESSIBILITY_AUDIT_FLOW.composerSendButton,
        );
        expect(
          perSend.length,
          "accessibility-audit.yaml should tap composer-send at least once",
        ).toBeGreaterThan(0);
        for (const texts of perSend) {
          expect(
            texts,
            `accessibility-audit.yaml: no assertVisible step after tapping "${ACCESSIBILITY_AUDIT_FLOW.composerSendButton}" ` +
              `asserts entryStatusLabel("failed") ("${failedLabel}")`,
          ).toContain(failedLabel);
          expect(
            texts,
            `accessibility-audit.yaml: an assertVisible step after tapping "${ACCESSIBILITY_AUDIT_FLOW.composerSendButton}" ` +
              `asserts entryStatusLabel("sent") ("${sentLabel}") — a state this unpaired flow cannot reach`,
          ).not.toContain(sentLabel);
        }
      },
    );

    it(
      "asserts the settings host row's name by CALLING settingsHostAccessibilityLabel, not by comparing two hand-typed copies (T368) — " +
        "the model is RN-free, so the yaml's literal is checked against what the screen will actually announce",
      () => {
        // The one reading this unpaired flow can reach: nothing is saved
        // (its connect-form submit fails validation on purpose) and no
        // connection exists, so `null` / `"idle"` is the real argument
        // pair, not a convenient one.
        const expected = settingsHostAccessibilityLabel(null, "idle");
        expect(ACCESSIBILITY_AUDIT_FLOW.settingsHostRowNoHostLabel).toBe(expected);

        const texts = steps
          .filter((step) => step.kind === "assertVisible" && step.text !== undefined)
          .map((step) => step.text);
        expect(
          texts,
          `accessibility-audit.yaml should assert the host row's whole accessible name ("${expected}")`,
        ).toContain(expected);
      },
    );

    it("reaches A2 and A3 by deep link and asserts each screen's own root before anything inside it (T368)", () => {
      const openedLinks = steps
        .filter((step) => step.kind === "openLink")
        .map((step) => step.value);
      expect(openedLinks).toContain(ACCESSIBILITY_AUDIT_FLOW.liveDeepLink);
      expect(openedLinks).toContain(ACCESSIBILITY_AUDIT_FLOW.settingsDeepLink);

      // Order matters: an id asserted before its screen is opened would
      // pass against whatever was still on screen from the step before.
      const indexOfStep = (predicate: (step: (typeof steps)[number]) => boolean) =>
        steps.findIndex(predicate);
      for (const [link, root, inner] of [
        [
          ACCESSIBILITY_AUDIT_FLOW.liveDeepLink,
          ACCESSIBILITY_AUDIT_FLOW.liveScreenRoot,
          ACCESSIBILITY_AUDIT_FLOW.liveBackButton,
        ],
        [
          ACCESSIBILITY_AUDIT_FLOW.settingsDeepLink,
          ACCESSIBILITY_AUDIT_FLOW.settingsScreenRoot,
          ACCESSIBILITY_AUDIT_FLOW.settingsHostRow,
        ],
      ] as const) {
        const openAt = indexOfStep((step) => step.kind === "openLink" && step.value === link);
        const rootAt = indexOfStep((step) => step.kind === "assertVisible" && step.id === root);
        const innerAt = indexOfStep((step) => step.kind === "assertVisible" && step.id === inner);
        expect(openAt, `${link} should be opened`).toBeGreaterThanOrEqual(0);
        expect(rootAt, `${root} should be asserted after ${link}`).toBeGreaterThan(openAt);
        expect(innerAt, `${inner} should be asserted after ${root}`).toBeGreaterThan(rootAt);
      }
    });

    it("never names the production daemon's port, in any form including comments", () => {
      expect(
        yamlText.includes(String(PRODUCTION_DAEMON_PORT)),
        `accessibility-audit.yaml must never name the production daemon port ${PRODUCTION_DAEMON_PORT}, in any form`,
      ).toBe(false);
    });
  });

  /**
   * The manual TalkBack pass and this flow are supposed to walk the same
   * controls -- `docs/accessibility-talkback-procedure.md` says so in its
   * own words, and that is the whole reason the mechanical flow is
   * described there as a partial substitute rather than a different
   * exercise. Nothing checked it, and it had already drifted: T368 added
   * A2 Live and A3 Settings to this flow, and the procedure's table kept
   * listing the three screens it knew about. A human following it would
   * have skipped both new screens and recorded a complete pass, which is
   * worse than having no procedure: the document would have certified
   * coverage it never had.
   *
   * These cases close that in both directions, and deliberately stop
   * there. They say nothing about what TalkBack announces -- a row added
   * to that table is not evidence about speech, and Part 1 of that
   * document exists precisely because nothing here can be.
   */
  describe("the manual TalkBack procedure walks the controls this flow samples (T373)", () => {
    const flowIds = auditedControlTestIds();
    const rows = talkbackProcedureRows();
    const documented = new Map<string, TalkbackTableRow>();
    for (const row of rows) {
      for (const id of row.ids) {
        documented.set(id, row);
      }
    }

    it("derives its control ids from the flow's own contract, and really finds them", () => {
      // A floor, not the exact count: this fails loudly if the shape
      // filter in `auditedControlTestIds` ever stops matching, instead
      // of passing against an empty set.
      expect(flowIds.length).toBeGreaterThanOrEqual(15);
      for (const id of flowIds) {
        expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
      }
      // The filter keeps ids and drops the announced labels and deep
      // links beside them, proven on one of each rather than asserted.
      expect(flowIds).toContain(ACCESSIBILITY_AUDIT_FLOW.composerMicButton);
      expect(flowIds).not.toContain(ACCESSIBILITY_AUDIT_FLOW.composerMicLabel);
      expect(flowIds).not.toContain(ACCESSIBILITY_AUDIT_FLOW.liveDeepLink);
      expect(flowIds).not.toContain(ACCESSIBILITY_AUDIT_FLOW.settingsHostRowNoHostLabel);
    });

    it("parses that table into rows rather than silently matching nothing", () => {
      expect(rows.length).toBeGreaterThanOrEqual(15);
      expect(documented.size).toBeGreaterThanOrEqual(flowIds.length);
      // Every row names a control in its first cell, so a mis-parse that
      // shifted the columns by one would fail here.
      for (const row of rows) {
        expect(
          row.control.length,
          `a table row should name a control: ${row.line}`,
        ).toBeGreaterThan(0);
      }
    });

    it("names every control id this flow asserts, so the manual pass cannot skip a screen", () => {
      for (const id of flowIds) {
        expect(
          documented.has(id),
          `docs/accessibility-talkback-procedure.md's Part 1 table must name \`${id}\` in its testID column -- accessibility-audit.yaml samples that control, so a human running the manual pass has to walk it too`,
        ).toBe(true);
      }
    });

    it("declares any control it lists that this flow does not sample", () => {
      for (const [id, row] of documented) {
        if (flowIds.includes(id)) {
          continue;
        }
        expect(
          row.line,
          `docs/accessibility-talkback-procedure.md lists \`${id}\`, which accessibility-audit.yaml does not sample, so that row must say "Not sampled mechanically" -- otherwise a reader takes the mechanical flow as covering it`,
        ).toMatch(/Not sampled mechanically/);
      }
    });

    it("still covers the context ring, which nothing mechanical reaches", () => {
      // The one intentional asymmetry, pinned so it cannot be quietly
      // dropped: `ContextRing.tsx` hides both the arc and the `34%`
      // numeral from the accessibility tree, so its accessible name is
      // the entire affordance, and this flow never opens the ring.
      const ring = documented.get("composer-context-ring");
      expect(
        ring,
        "the procedure must keep a row for composer-context-ring: it is the only coverage that control has",
      ).toBeDefined();
      expect(ring?.line).toMatch(/Not sampled mechanically/);
      expect(flowIds).not.toContain("composer-context-ring");
    });
  });
});
