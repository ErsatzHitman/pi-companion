// Loader for this directory's §11.7 extension fixtures. See ./README.md.
//
// Scenarios are plain typed TS modules (not runtime JSON file reads): this
// package's purity guard (../../../import-guard.test.ts,
// ../../../.oxlintrc.json) disallows Node ambient globals in src/, and
// static imports keep these fixtures usable from any bundler (web/Android),
// not just Node tests — matching ../../timeline/fixtures/index.ts and
// ../recorded-session.ts's own convention.

import { advisorFixture } from "./scenarios/advisor.js";
import { askUserFixture } from "./scenarios/ask-user.js";
import { btwFixture } from "./scenarios/btw.js";
import { loopFixture } from "./scenarios/loop.js";
import { minimalStatusFixture } from "./scenarios/minimal-status.js";
import { piGoalFixture } from "./scenarios/pi-goal.js";
import { planModeFixture } from "./scenarios/plan-mode.js";
import { promptArbitrageFixture } from "./scenarios/prompt-arbitrage.js";
import { subagentsFixture } from "./scenarios/subagents.js";
import { switchboardFixture } from "./scenarios/switchboard.js";
import { todoFixture } from "./scenarios/todo.js";
import { workflowsFixture } from "./scenarios/workflows.js";
import type { ExtensionFixtureScenario } from "./types.js";

export type { ExtensionFixtureScenario, FixtureFrame, FixtureFrameDirection } from "./types.js";
export {
  agentStreamEventFromFrame,
  agentStreamMessageFromFrame,
  frameById,
  sessionInboundMessageFromFrame,
  sessionOutboundMessageFromFrame,
} from "./wire.js";

/**
 * All twelve of plan.md §11.7's "First-class UI through bridge elements"
 * table: T40A1's `loop`, `subagents`, `todo`, `advisor`, `minimal-status`,
 * `plan-mode`, `pi-goal`, `prompt-arbitrage`, plus T40A2's `btw`,
 * `switchboard`, `workflows`, and rich `ask-user`.
 */
const EXTENSION_FIXTURES: readonly ExtensionFixtureScenario[] = [
  advisorFixture,
  askUserFixture,
  btwFixture,
  loopFixture,
  minimalStatusFixture,
  piGoalFixture,
  planModeFixture,
  promptArbitrageFixture,
  subagentsFixture,
  switchboardFixture,
  todoFixture,
  workflowsFixture,
];

/** §11.7 extension names covered so far, sorted for stable order. */
export function listExtensionFixtures(): string[] {
  return EXTENSION_FIXTURES.map((fixture) => fixture.extension).sort();
}

/** Loads one extension's fixture scenario by its §11.7 name. */
export function loadExtensionFixture(extension: string): ExtensionFixtureScenario {
  const found = EXTENSION_FIXTURES.find((candidate) => candidate.extension === extension);
  if (!found) {
    throw new Error(`unknown extension fixture: ${extension}`);
  }
  return found;
}

/** Loads every covered extension's fixture scenario, sorted by name. */
export function loadAllExtensionFixtures(): ExtensionFixtureScenario[] {
  return listExtensionFixtures().map(loadExtensionFixture);
}
