import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { describeRecoveredTurn } from "../../src/features/transcript/recovered-turn-model.js";
import { RECOVERED_TURN_BANNER_FLOW } from "./recovered-turn-banner-contract.js";
import { PRODUCTION_DAEMON_PORT } from "../harness/production-daemon-port.js";
import { parseMaestroSteps, type MaestroStep } from "./maestro-yaml.js";

/**
 * T106 — proves every testId/string
 * `../../maestro/recovered-turn-banner.yaml` names still exists in the
 * real source it targets, and that its step sequence really does what
 * its header claims. Same rationale and precedent as
 * `composer-inputs.contract.test.ts` (T37E3/T72): there is no emulator,
 * device, or Maestro binary in this wave, so this file is the flow's
 * only proof of life — and this file is what keeps the yaml's
 * restatement of `recovered-turn-banner-contract.ts` honest, not that
 * file by itself (T72's own finding, `maestro-yaml.ts`'s doc comment).
 *
 * Two proof strategies, chosen per module (identical split to
 * `composer-inputs.contract.test.ts`):
 *
 * - `recovered-turn-model.ts` is RN-free, so this file imports it
 *   directly and calls the real `describeRecoveredTurn`.
 * - `../../src/app/dev/recovered-turn-lab.tsx` (route wrapper) and
 *   `../../src/dev/recovered-turn-lab.tsx` (lab content) both import
 *   `react-native`/`expo-router` and are read with `readCode()`
 *   (comment-stripped) and matched against a full JSX/statement
 *   expression, anchored (via `readComponentCode`) to the one top-level
 *   function that owns it — never a bare identifier (CLAUDE.md's
 *   "SOURCE-TEXT REGEX TESTS ARE ON PROBATION" note).
 *
 * Mutation-checked (see this task's report for the exact mutations,
 * their failures, and the byte-identical restores): the openLink URL
 * matching the route wrapper's own file location, the fixture-turn ids
 * matching the lab's `FIXTURE_TURNS`, and the "never names the
 * production daemon's port" check.
 */

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Slices `readCode(relativePath)` down to one top-level `function`/`export function` declaration, by name. */
function readComponentCode(relativePath: string, name: string): string {
  const code = readCode(relativePath);
  const body = code
    .split(/^(?:export default |export )?function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith(`function ${name}(`));
  expect(body, `${relativePath} should declare a top-level function ${name}`).toBeDefined();
  return body ?? "";
}

const ROUTE_WRAPPER_TSX = "../../src/app/dev/recovered-turn-lab.tsx";
const LAB_CONTENT_TSX = "../../src/dev/recovered-turn-lab.tsx";
const BANNER_TSX = "../../src/features/transcript/recovered-turn-banner.tsx";

describe("recovered-turn-banner.yaml anchors exist in source", () => {
  describe("the dev-lab deep link this flow opens", () => {
    it('app.config.ts registers the "picompanion" scheme the flow\'s openLink URL uses', () => {
      const appConfig = readCode("../../app.config.ts");
      expect(appConfig).toMatch(/scheme:\s*"picompanion"/);
    });

    it("the route wrapper's own file location (app/dev/recovered-turn-lab.tsx) is exactly what the flow's deep link path names", () => {
      // Expo Router resolves `picompanion://dev/recovered-turn-lab`
      // against `app/dev/recovered-turn-lab.tsx` by file position, not
      // by any string this file declares — so the real assertion here
      // is that the route file exists at that exact path (readSource
      // throws ENOENT otherwise) and is a real default-exported
      // component, not a stub.
      const source = readCode(ROUTE_WRAPPER_TSX);
      expect(source).toMatch(/export default function DevRecoveredTurnLabRoute/);
    });

    it("gates the real lab behind __DEV__ so a release build's copy of this route never renders the lab", () => {
      const route = readComponentCode(ROUTE_WRAPPER_TSX, "DevRecoveredTurnLabRoute");
      expect(route).toMatch(/if \(!__DEV__\)/);
      expect(route).toMatch(/<Redirect href="\/" \/>/);
    });

    it("lazily imports the lab content from ../../dev/recovered-turn-lab, matching LAB_CONTENT_TSX's real path", () => {
      // The `lazy(...)` call is a module-level const, not inside the
      // route function body — matched against the whole file's code
      // (still comment-stripped), same as `component-lab.test.ts`'s own
      // precedent for this exact convention.
      const code = readCode(ROUTE_WRAPPER_TSX);
      expect(code).toMatch(/lazy\(\(\) => import\("\.\.\/\.\.\/dev\/recovered-turn-lab"\)\)/);
    });
  });

  describe("recovered-turn-lab.tsx (content) mounts the real banner against the exact fixture the flow asserts", () => {
    const lab = () => readComponentCode(LAB_CONTENT_TSX, "RecoveredTurnLab");

    it("declares a testID recovered-turn-lab root and a recovered-turn-lab-status Text", () => {
      const body = lab();
      expect(body).toMatch(/testID="recovered-turn-lab"/);
      expect(body).toMatch(/testID="recovered-turn-lab-status"/);
    });

    it('the status Text\'s content is exactly `Last action: ${lastAction}` — "Last action: none" at mount, per useState("none")', () => {
      const body = lab();
      expect(body).toMatch(/useState\("none"\)/);
      expect(body).toMatch(/\{`Last action: \$\{lastAction\}`\}/);
    });

    it("FIXTURE_TURNS carries exactly the two ids the flow taps/asserts (lab-turn-1, lab-turn-2)", () => {
      const code = readCode(LAB_CONTENT_TSX);
      const fixtureBlock = code
        .split("export function RecoveredTurnLab")[0]
        .split("const FIXTURE_TURNS")[1];
      expect(
        fixtureBlock,
        "recovered-turn-lab.tsx should declare a top-level FIXTURE_TURNS constant",
      ).toBeDefined();
      expect(fixtureBlock).toMatch(new RegExp(`id:\\s*"${RECOVERED_TURN_BANNER_FLOW.turnOneId}"`));
      expect(fixtureBlock).toMatch(new RegExp(`id:\\s*"${RECOVERED_TURN_BANNER_FLOW.turnTwoId}"`));
      // Both fixture entries must be the one outcome RecoveredTurnBanner
      // ever renders a Banner for — asserting anything else here would
      // silently stop proving what this flow claims to prove.
      expect(fixtureBlock?.match(/outcome:\s*"awaiting-confirmation"/g)).toHaveLength(2);
    });

    it("passes both `turns` and a real outbox object into RecoveredTurnBanner, never display-only", () => {
      const body = lab();
      expect(body).toMatch(/<RecoveredTurnBanner turns=\{turns\} outbox=\{outbox\} \/>/);
    });

    it("the inline outbox's confirmResend/remove update lastAction and drop the acted-on turn out of `turns` — the observable state Resend/Discard must change", () => {
      const body = lab();
      expect(body).toMatch(/setLastAction\(`confirmed \$\{id\}`\)/);
      expect(body).toMatch(/setLastAction\(`discarded \$\{id\}`\)/);
      const dropCalls = body.match(
        /setTurns\(\(current\) => current\.filter\(\(turn\) => turn\.id !== id\)\)/g,
      );
      expect(
        dropCalls,
        "both confirmResend and remove should filter the acted-on turn out of `turns`",
      ).toHaveLength(2);
    });
  });

  describe("recovered-turn-banner.tsx's own testId pattern matches the flow's per-turn ids", () => {
    const banner = () => readComponentCode(BANNER_TSX, "RecoveredTurnBanner");

    it("Banner testId is `recovered-turn-banner-${turn.id}`, matching bannerIdFor", () => {
      expect(banner()).toMatch(/testId=\{`recovered-turn-banner-\$\{turn\.id\}`\}/);
    });

    it("the actions View testID is `recovered-turn-banner-${turn.id}-actions`, matching actionsIdFor", () => {
      expect(banner()).toMatch(/testID=\{`recovered-turn-banner-\$\{turn\.id\}-actions`\}/);
    });

    it("the Resend Button testId is `recovered-turn-banner-${turn.id}-confirm`, matching confirmIdFor", () => {
      expect(banner()).toMatch(/testId=\{`recovered-turn-banner-\$\{turn\.id\}-confirm`\}/);
    });

    it("the Discard Button testId is `recovered-turn-banner-${turn.id}-discard`, matching discardIdFor", () => {
      expect(banner()).toMatch(/testId=\{`recovered-turn-banner-\$\{turn\.id\}-discard`\}/);
    });

    it("the actions row only mounts when an outbox prop is supplied — display-only stays display-only when it is not", () => {
      expect(banner()).toMatch(/\{outbox \? \(/);
    });
  });
});

describe("recovered-turn-banner.yaml itself, read from disk", () => {
  const RECOVERED_TURN_BANNER_YAML = "../../maestro/recovered-turn-banner.yaml";
  const yamlText = readSource(RECOVERED_TURN_BANNER_YAML);
  const steps = parseMaestroSteps(yamlText);

  it("opens exactly RECOVERED_TURN_BANNER_FLOW.labDeepLink via openLink", () => {
    const opens = steps.filter((step) => step.kind === "openLink").map((step) => step.value);
    expect(opens).toEqual([RECOVERED_TURN_BANNER_FLOW.labDeepLink]);
  });

  it("asserts describeRecoveredTurn()'s exact real sentence, not a hand-typed stand-in", () => {
    // Both fixture turns render the same sentence (describeRecoveredTurn
    // ignores its argument today) — a hand-built AwaitingConfirmationTurn
    // fixture is enough to prove the yaml's text against the real
    // function, without needing a real recovered-turn pipeline.
    const fixtureTurn = {
      id: RECOVERED_TURN_BANNER_FLOW.turnOneId,
      sessionId: "lab-session",
      kind: "prompt",
      outcome: "awaiting-confirmation",
      status: "awaiting-confirmation",
    } as const;
    const sentence = describeRecoveredTurn(fixtureTurn);
    const assertedTexts = steps
      .filter((step) => step.kind === "assertVisible" && step.text !== undefined)
      .map((step) => step.text as string);
    expect(assertedTexts).toContain(sentence);
  });

  it("asserts both fixture turns' banner ids visible before either action is taken", () => {
    const firstConfirmTap = steps.findIndex(
      (step) =>
        step.kind === "tapOn" &&
        step.id === RECOVERED_TURN_BANNER_FLOW.confirmIdFor(RECOVERED_TURN_BANNER_FLOW.turnOneId),
    );
    expect(firstConfirmTap).toBeGreaterThan(-1);
    const before = steps.slice(0, firstConfirmTap);
    const assertedIds = before
      .filter((step) => step.kind === "assertVisible" && step.id !== undefined)
      .map((step) => step.id as string);
    expect(assertedIds).toContain(
      RECOVERED_TURN_BANNER_FLOW.bannerIdFor(RECOVERED_TURN_BANNER_FLOW.turnOneId),
    );
    expect(assertedIds).toContain(
      RECOVERED_TURN_BANNER_FLOW.bannerIdFor(RECOVERED_TURN_BANNER_FLOW.turnTwoId),
    );
  });

  function stepsBetween(fromKind: string, fromId: string, count = 6): MaestroStep[] {
    const start = steps.findIndex((step) => step.kind === fromKind && step.id === fromId);
    expect(start, `expected a ${fromKind} step with id="${fromId}"`).toBeGreaterThan(-1);
    return steps.slice(start, start + count);
  }

  it("tapping Resend on turn-1 is followed by the status update AND both turn-1's banner and its actions row going invisible — not just registration", () => {
    const after = stepsBetween(
      "tapOn",
      RECOVERED_TURN_BANNER_FLOW.confirmIdFor(RECOVERED_TURN_BANNER_FLOW.turnOneId),
    );
    const assertVisibleTexts = after
      .filter((s) => s.kind === "assertVisible" && s.text !== undefined)
      .map((s) => s.text);
    const assertNotVisibleIds = after
      .filter((s) => s.kind === "assertNotVisible" && s.id !== undefined)
      .map((s) => s.id);
    expect(assertVisibleTexts).toContain(
      `Last action: confirmed ${RECOVERED_TURN_BANNER_FLOW.turnOneId}`,
    );
    expect(assertNotVisibleIds).toContain(
      RECOVERED_TURN_BANNER_FLOW.bannerIdFor(RECOVERED_TURN_BANNER_FLOW.turnOneId),
    );
    expect(assertNotVisibleIds).toContain(
      RECOVERED_TURN_BANNER_FLOW.actionsIdFor(RECOVERED_TURN_BANNER_FLOW.turnOneId),
    );
  });

  it("tapping Discard on turn-2 is followed by the status update AND both turn-2's banner and its actions row going invisible", () => {
    const after = stepsBetween(
      "tapOn",
      RECOVERED_TURN_BANNER_FLOW.discardIdFor(RECOVERED_TURN_BANNER_FLOW.turnTwoId),
    );
    const assertVisibleTexts = after
      .filter((s) => s.kind === "assertVisible" && s.text !== undefined)
      .map((s) => s.text);
    const assertNotVisibleIds = after
      .filter((s) => s.kind === "assertNotVisible" && s.id !== undefined)
      .map((s) => s.id);
    expect(assertVisibleTexts).toContain(
      `Last action: discarded ${RECOVERED_TURN_BANNER_FLOW.turnTwoId}`,
    );
    expect(assertNotVisibleIds).toContain(
      RECOVERED_TURN_BANNER_FLOW.bannerIdFor(RECOVERED_TURN_BANNER_FLOW.turnTwoId),
    );
    expect(assertNotVisibleIds).toContain(
      RECOVERED_TURN_BANNER_FLOW.actionsIdFor(RECOVERED_TURN_BANNER_FLOW.turnTwoId),
    );
  });

  it("mounts both Resend AND Discard — never proves only half the pair", () => {
    const tappedIds = steps.filter((s) => s.kind === "tapOn").map((s) => s.id);
    expect(tappedIds).toContain(
      RECOVERED_TURN_BANNER_FLOW.confirmIdFor(RECOVERED_TURN_BANNER_FLOW.turnOneId),
    );
    expect(tappedIds).toContain(
      RECOVERED_TURN_BANNER_FLOW.discardIdFor(RECOVERED_TURN_BANNER_FLOW.turnTwoId),
    );
  });

  it("never names the production daemon's port, in any form including comments", () => {
    expect(
      yamlText.includes(String(PRODUCTION_DAEMON_PORT)),
      `recovered-turn-banner.yaml must never name the production daemon port ${PRODUCTION_DAEMON_PORT}, ` +
        "in any form (this flow's own header already says it talks to no daemon at all)",
    ).toBe(false);
  });
});
