import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { describeQueueModesUnavailable } from "../../src/features/composer/queue-mode-model.js";
import {
  INITIAL_SESSION_CONTROLS_STATE,
  describeSessionControlsUnavailable,
} from "../../src/features/composer/session-controls-model.js";
import { QUEUE_RETRY_COMPACTION_FLOW } from "./queue-retry-compaction-contract.js";
import { PRODUCTION_DAEMON_PORT } from "../harness/production-daemon-port.js";
import { parseMaestroSteps } from "./maestro-yaml.js";

/**
 * T39C — proves every testId/string
 * `../../maestro/queue-retry-compaction.yaml` names still exists in the
 * real source it targets, and that the "no client is wired at this
 * route, so only the unavailable state is reachable" claim in that
 * flow's header comment is actually true today. Same rationale and
 * precedent as `composer-inputs.contract.test.ts` (T37E3): there is no
 * emulator, device, or Maestro binary in this wave, so this file is the
 * flow's only proof of life. The on-device half stays disclosed as
 * unrun — see this task's (T39C) report.
 *
 * `readComponentCode` anchors every assertion to the one top-level
 * function it names — `Composer.tsx` declares more than one top-level
 * function, and a whole-file `toMatch` would let a sibling occurrence
 * satisfy an assertion it does not actually own.
 *
 * Every assertion below was mutation-checked by hand (delete the real
 * construct, re-run this file, confirm the specific `it` fails, restore
 * byte-identically). See this task's report for the run log.
 */

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

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

describe("queue-retry-compaction.yaml anchors exist in source", () => {
  // T132 (P6-W10) wired `queueModeClient`/`turnStatusClient` into this
  // exact mount, resolved off `AppCore.connection`'s active lifecycle
  // (`./session-route-daemon-clients.ts`) — the gap this describe block
  // used to name ("no queueModeClient/turnStatusClient wired in") is
  // closed. This harness still has no live daemon connection (no
  // emulator, no device — see this file's own doc comment), so the
  // resolved value is still `undefined` and `QueueModePicker`/
  // `TurnStatusBanner` still render exactly the same "no-client"
  // unavailable state every other assertion in this file already
  // proves — only the REASON changed, from "no route passes the prop at
  // all" to "the prop resolves to undefined with no active connection".
  describe("the session route this flow reaches — queueModeClient/turnStatusClient are wired, but resolve to undefined with no live connection", () => {
    it("SessionRoute's <Composer> element passes both queueModeClient and turnStatusClient, resolved from AppCore.connection", () => {
      const code = readComponentCode(SESSION_ROUTE_TSX, "SessionRoute");
      const composerElementMatch = code.match(/<Composer\s[\s\S]*?\/>/);
      expect(
        composerElementMatch,
        "SessionRoute should render a <Composer ... /> element",
      ).not.toBeNull();
      const composerElement = composerElementMatch?.[0] ?? "";
      expect(composerElement).toMatch(/queueModeClient=\{queueModeClient\}/);
      expect(composerElement).toMatch(/turnStatusClient=\{turnStatusClient\}/);
      expect(code).toMatch(/const queueModeClient = resolveQueueModeClient\(core\.connection\);/);
      expect(code).toMatch(/const turnStatusClient = resolveTurnStatusClient\(core\.connection\);/);
    });
  });

  describe("QueueModePicker mount renders the truthful no-client unavailable state at this route", () => {
    it('Composer mounts <QueueModePicker> with testId="${composerTestId}-queue-mode"', () => {
      const code = readComponentCode(COMPOSER_TSX, "Composer");
      expect(code).toMatch(/<QueueModePicker\s*\n\s*state=\{queueModesState\}/);
      expect(code).toMatch(/testId=\{`\$\{composerTestId\}-queue-mode`\}/);
    });

    it('QueueModePicker renders state.unavailableReason under testId="${testId}-unavailable" while non-ready', () => {
      const code = readComponentCode(
        "../../src/features/composer/QueueModePicker.tsx",
        "QueueModePicker",
      );
      expect(code).toMatch(/if \(state\.availability !== "ready"\) \{/);
      expect(code).toMatch(/testID=\{`\$\{testId\}-unavailable`\}/);
    });

    it('describeQueueModesUnavailable("no-client") is exactly the sentence this flow asserts, and INITIAL_QUEUE_MODES_STATE starts in that state', () => {
      expect(describeQueueModesUnavailable("no-client")).toBe(
        QUEUE_RETRY_COMPACTION_FLOW.queueModeUnavailableText,
      );
      const model = readCode("../../src/features/composer/queue-mode-model.ts");
      expect(model).toMatch(/unavailableReason: describeQueueModesUnavailable\("no-client"\),/);
    });

    it("Composer builds its queueModesController from a client prop with no fallback default — an omitted prop genuinely leaves it undefined", () => {
      const code = readCode(COMPOSER_TSX);
      expect(code).toMatch(
        /createQueueModesController\(\{ agentId: resolvedSessionId, client: queueModeClient \}\)/,
      );
      expect(code).not.toMatch(/queueModeClient\s*\?\?/);
    });
  });

  describe("TurnStatusBanner mount renders nothing at this route (no turnStatusClient, no alwaysShowUnavailable override)", () => {
    it("Composer mounts <TurnStatusBanner> with no alwaysShowUnavailable prop, so it defaults to false", () => {
      const code = readComponentCode(COMPOSER_TSX, "Composer");
      const bannerMatch = code.match(/<TurnStatusBanner\s[\s\S]*?\/>/);
      expect(
        bannerMatch,
        "Composer should render a <TurnStatusBanner ... /> element",
      ).not.toBeNull();
      const bannerElement = bannerMatch?.[0] ?? "";
      expect(bannerElement).not.toMatch(/alwaysShowUnavailable/);
    });

    it("TurnStatusBanner returns null (not the unavailable Banner) when alwaysShowUnavailable is false", () => {
      const code = readComponentCode(
        "../../src/features/composer/TurnStatusBanner.tsx",
        "TurnStatusBanner",
      );
      expect(code).toMatch(
        /if \(state\.availability !== "ready"\) \{\s*\n\s*if \(!alwaysShowUnavailable\) return null;/,
      );
    });
  });

  // T39C: same gap `composer-inputs.contract.test.ts` (T72) closed for
  // composer-inputs.yaml — nothing above ever opens
  // queue-retry-compaction.yaml itself, so this block parses its real
  // steps and checks them against the same real values the rest of this
  // file already proves are honest.
  describe("queue-retry-compaction.yaml itself, read from disk", () => {
    const FLOW_YAML = "../../maestro/queue-retry-compaction.yaml";
    const yamlText = readSource(FLOW_YAML);
    const steps = parseMaestroSteps(yamlText);

    it("opens the same session deep link this contract names", () => {
      const openLinkStep = steps.find((step) => step.kind === "openLink");
      expect(openLinkStep?.value).toBe(QUEUE_RETRY_COMPACTION_FLOW.sessionDeepLink);
    });

    it("asserts the composer root, the queue-mode-picker root, and its unavailable testId", () => {
      const ids = steps.filter((step) => step.id !== undefined).map((step) => step.id as string);
      expect(ids).toContain(QUEUE_RETRY_COMPACTION_FLOW.composerRoot);
      expect(ids).toContain(QUEUE_RETRY_COMPACTION_FLOW.queueModePickerRoot);
      expect(ids).toContain(QUEUE_RETRY_COMPACTION_FLOW.queueModePickerUnavailable);
    });

    // T353 moved the queue-mode picker into the context-ring menu. A
    // node inside a closed `Sheet` is not rendered at all, so a flow
    // that still asserted it straight after `openLink` would fail on a
    // real device with a "not visible" that looks like a regression in
    // the picker rather than a stale flow. These two cases pin the tap
    // and its ordering so that cannot happen silently.
    it("T353: taps the context ring before asserting anything inside the menu it opens", () => {
      const ringIndex = steps.findIndex(
        (step) => step.kind === "tapOn" && step.id === QUEUE_RETRY_COMPACTION_FLOW.contextRing,
      );
      expect(
        ringIndex,
        `queue-retry-compaction.yaml should tapOn id="${QUEUE_RETRY_COMPACTION_FLOW.contextRing}"`,
      ).toBeGreaterThanOrEqual(0);
      const pickerIndex = steps.findIndex(
        (step) => step.id === QUEUE_RETRY_COMPACTION_FLOW.queueModePickerRoot,
      );
      expect(pickerIndex).toBeGreaterThan(ringIndex);
    });

    it("T353: asserts the menu itself is open, so a tap that misses reads as a tap that missed", () => {
      const ids = steps.filter((step) => step.id !== undefined).map((step) => step.id as string);
      expect(ids).toContain(QUEUE_RETRY_COMPACTION_FLOW.controlsMenu);
    });

    it("T353: the ring and the menu it opens carry the ids this flow names, at their real Composer.tsx mounts", () => {
      const composer = readComponentCode(COMPOSER_TSX, "Composer");
      expect(composer).toMatch(/testId=\{`\$\{composerTestId\}-context-ring`\}/);
      expect(composer).toMatch(/testId=\{`\$\{composerTestId\}-controls-menu`\}/);
      expect(QUEUE_RETRY_COMPACTION_FLOW.contextRing).toBe("composer-context-ring");
      expect(QUEUE_RETRY_COMPACTION_FLOW.controlsMenu).toBe("composer-controls-menu");
    });

    // T354 added the Build/Plan mode control and the auto-compaction
    // switch to the same menu. They land in the same "no client is
    // wired at this route" shape every other control in this flow is
    // in, so these three cases pin the same three things: the tap
    // ordering, the exact sentence, and the real mount's testId.
    it("T354: asserts the session-controls picker only after the ring has opened the menu", () => {
      const ringIndex = steps.findIndex(
        (step) => step.kind === "tapOn" && step.id === QUEUE_RETRY_COMPACTION_FLOW.contextRing,
      );
      const pickerIndex = steps.findIndex(
        (step) => step.id === QUEUE_RETRY_COMPACTION_FLOW.sessionControlsRoot,
      );
      expect(
        pickerIndex,
        `queue-retry-compaction.yaml should assertVisible id="${QUEUE_RETRY_COMPACTION_FLOW.sessionControlsRoot}"`,
      ).toBeGreaterThanOrEqual(0);
      expect(pickerIndex).toBeGreaterThan(ringIndex);
    });

    it("T354: asserts the session-controls unavailable sentence, exactly as the model spells it", () => {
      const assertedTexts = steps
        .filter((step) => step.kind === "assertVisible" && step.text !== undefined)
        .map((step) => step.text as string);
      expect(assertedTexts).toContain(describeSessionControlsUnavailable("no-client"));
      expect(QUEUE_RETRY_COMPACTION_FLOW.sessionControlsUnavailableText).toBe(
        describeSessionControlsUnavailable("no-client"),
      );
      // The controller reaches that state with no `load()` attempted at
      // all, which is why the flow can assert the sentence immediately
      // after opening the menu rather than waiting on a round trip.
      expect(INITIAL_SESSION_CONTROLS_STATE.availability).toBe("no-client");
    });

    it("T354: the picker carries the id this flow names, at its real Composer.tsx mount", () => {
      const composer = readComponentCode(COMPOSER_TSX, "Composer");
      expect(composer).toMatch(/testId=\{`\$\{composerTestId\}-session-controls`\}/);
      expect(QUEUE_RETRY_COMPACTION_FLOW.sessionControlsRoot).toBe("composer-session-controls");
    });

    it('asserts describeQueueModesUnavailable("no-client")\'s real copy, exactly', () => {
      const assertedTexts = steps
        .filter((step) => step.kind === "assertVisible" && step.text !== undefined)
        .map((step) => step.text as string);
      expect(assertedTexts).toContain(describeQueueModesUnavailable("no-client"));
    });

    it("asserts composer-queue-mode-unavailable's id immediately before its own text, not floating free of it", () => {
      const unavailableIdIndex = steps.findIndex(
        (step) => step.id === QUEUE_RETRY_COMPACTION_FLOW.queueModePickerUnavailable,
      );
      expect(
        unavailableIdIndex,
        `queue-retry-compaction.yaml should assertVisible id="${QUEUE_RETRY_COMPACTION_FLOW.queueModePickerUnavailable}"`,
      ).toBeGreaterThanOrEqual(0);
      const nextStep = steps[unavailableIdIndex + 1];
      expect(
        nextStep?.text,
        "the very next step should assertVisible the unavailable sentence's own text",
      ).toBe(describeQueueModesUnavailable("no-client"));
    });

    it("never names composer-turn-status or any TurnStatusBanner text — this flow discloses that gap, it does not paper over it", () => {
      expect(yamlText).not.toMatch(/composer-turn-status/);
    });

    it("never names the production daemon's port, in any form including comments", () => {
      expect(
        yamlText.includes(String(PRODUCTION_DAEMON_PORT)),
        `queue-retry-compaction.yaml must never name the production daemon port ${PRODUCTION_DAEMON_PORT}, in any form`,
      ).toBe(false);
    });
  });
});
