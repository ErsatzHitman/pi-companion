import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared Pi RPC event fixtures.
 *
 * These are synthetic (not recorded from a real Pi session) sequences of Pi RPC
 * events shaped like `packages/server/src/server/agent/providers/pi/rpc-types.ts`
 * `PiRuntimeEvent`. They exist so protocol-, server-, and (later) frontend-core
 * tests can assert behavior against realistic event sequences without depending
 * on a live Pi process, and without ever containing a real path or credential.
 *
 * See ./README.md for the full inventory and plan §14.2 mapping.
 */

const scenariosDir = join(dirname(fileURLToPath(import.meta.url)), "scenarios");

/** Loose shape of a single recorded Pi RPC event; intentionally not strongly
 * typed against `PiRuntimeEvent` to avoid a protocol -> server dependency. */
export interface PiRpcFixtureEvent {
  type: string;
  [key: string]: unknown;
}

export interface PiRpcFixtureScenario {
  /** File name (without extension) the scenario was loaded from. */
  fileName: string;
  scenario: string;
  description: string;
  /** plan.md §14.2 bullet(s) this scenario proves; may be empty for
   * scenarios captured purely for full 21-type coverage. */
  planBullets: string[];
  notes?: string;
  sessionId?: string;
  events: PiRpcFixtureEvent[];
}

/**
 * The 21 Pi RPC event types required by plan.md §14 (see the explicit list
 * near "The event fixture set must cover all 21 Pi RPC event types"). Order
 * matches that list.
 */
export const PI_RPC_EVENT_TYPES = [
  "agent_start",
  "agent_end",
  "agent_settled",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "bash_execution_update",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "queue_update",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "extension_error",
] as const;

export type PiRpcEventType = (typeof PI_RPC_EVENT_TYPES)[number];

function loadScenario(fileName: string): PiRpcFixtureScenario {
  const raw = readFileSync(join(scenariosDir, fileName), "utf8");
  const parsed = JSON.parse(raw) as Omit<PiRpcFixtureScenario, "fileName">;
  return { fileName: fileName.replace(/\.json$/, ""), ...parsed };
}

/** Loads every recorded scenario fixture, sorted by file name for stable order. */
export function loadPiRpcFixtureScenarios(): PiRpcFixtureScenario[] {
  const fileNames = readdirSync(scenariosDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return fileNames.map(loadScenario);
}

/** All events across every scenario, in scenario file order. */
export function loadAllPiRpcFixtureEvents(): PiRpcFixtureEvent[] {
  return loadPiRpcFixtureScenarios().flatMap((scenario) => scenario.events);
}
