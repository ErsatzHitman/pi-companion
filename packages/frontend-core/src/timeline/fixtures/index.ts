// Loader for this directory's timeline reducer fixtures. See ./README.md.
//
// Scenarios are plain typed TS modules (not runtime JSON file reads): this
// package's purity guard (../../import-guard.test.ts, ../../.oxlintrc.json)
// disallows Node ambient globals in src/, and static imports keep these
// fixtures usable from any bundler (web/Android), not just Node tests.

import { assistantMessageCorrectionScenario } from "./scenarios/assistant-message-correction.js";
import { gapBackfillScenario } from "./scenarios/gap-backfill.js";
import { messageAttachmentsScenario } from "./scenarios/message-attachments.js";
import { optimisticUserMessageScenario } from "./scenarios/optimistic-user-message.js";
import { restartRecoveryScenario } from "./scenarios/restart-recovery.js";
import { toolCallLifecycleScenario } from "./scenarios/tool-call-lifecycle.js";
import type { TimelineFixtureScenario } from "./types.js";

export type { FixtureFrame, FixtureFrameDirection, TimelineFixtureScenario } from "./types.js";

const SCENARIOS: readonly TimelineFixtureScenario[] = [
  assistantMessageCorrectionScenario,
  gapBackfillScenario,
  messageAttachmentsScenario,
  optimisticUserMessageScenario,
  restartRecoveryScenario,
  toolCallLifecycleScenario,
];

/** File names (without extension) for every recorded scenario in this directory. */
export function listTimelineFixtureScenarios(): string[] {
  return SCENARIOS.map((scenario) => scenario.scenario).sort();
}

/** Loads one scenario fixture by name. */
export function loadTimelineFixtureScenario(scenario: string): TimelineFixtureScenario {
  const found = SCENARIOS.find((candidate) => candidate.scenario === scenario);
  if (!found) {
    throw new Error(`unknown timeline fixture scenario: ${scenario}`);
  }
  return found;
}

/** Loads every recorded scenario fixture, sorted by scenario name for stable order. */
export function loadAllTimelineFixtureScenarios(): TimelineFixtureScenario[] {
  return listTimelineFixtureScenarios().map(loadTimelineFixtureScenario);
}
