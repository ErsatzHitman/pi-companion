// Loader for the recorded payload-compatibility fixtures. See README.md for
// scope and plan.md §4.2 step 7 ("add fixtures for old helper -> old client,
// old helper -> new client, new helper -> old client, and new helper -> new
// client"). Task: T07C (`docs/issues-from-plan.md`).

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PayloadCompatFixture } from "./types.js";

export type {
  PayloadCompatFixture,
  PayloadCompatFixtureElement,
  PayloadCompatHelperVersion,
  PayloadCompatClientCapability,
} from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const PAYLOAD_COMPAT_DIR = join(here, "payload-compat");

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function jsonFileNames(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

/** File names (without extension) for every recorded payload-compat scenario. */
export function listPayloadCompatScenarios(): string[] {
  return jsonFileNames(PAYLOAD_COMPAT_DIR).map((name) => name.replace(/\.json$/, ""));
}

/** Loads one payload-compat scenario fixture by file name (with or without .json). */
export function loadPayloadCompatFixture(scenario: string): PayloadCompatFixture {
  const fileName = scenario.endsWith(".json") ? scenario : `${scenario}.json`;
  return readJsonFile<PayloadCompatFixture>(join(PAYLOAD_COMPAT_DIR, fileName));
}

/** Loads every recorded payload-compat scenario fixture. */
export function loadAllPayloadCompatFixtures(): PayloadCompatFixture[] {
  return listPayloadCompatScenarios().map((scenario) => loadPayloadCompatFixture(scenario));
}
