// Shared loader for the recorded daemon WebSocket and Pi UI Bridge fixtures.
//
// These fixtures are plain, synthetic-data JSON files (no live daemon or Pi
// agent required to replay them). See README.md for scope and plan.md §14.2.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DaemonWsFixture, PiUiBridgeFixture } from "./types.js";

export type {
  DaemonWsFixture,
  PiUiBridgeFixture,
  FixtureFrame,
  FixtureFrameDirection,
} from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const DAEMON_WS_DIR = join(here, "daemon-ws");
const PI_UI_BRIDGE_DIR = join(here, "pi-ui-bridge");

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function jsonFileNames(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

/** File names (without extension) for every recorded daemon WebSocket scenario. */
export function listDaemonWsScenarios(): string[] {
  return jsonFileNames(DAEMON_WS_DIR).map((name) => name.replace(/\.json$/, ""));
}

/** Loads one daemon WebSocket scenario fixture by file name (with or without .json). */
export function loadDaemonWsFixture(scenario: string): DaemonWsFixture {
  const fileName = scenario.endsWith(".json") ? scenario : `${scenario}.json`;
  return readJsonFile<DaemonWsFixture>(join(DAEMON_WS_DIR, fileName));
}

/** Loads every recorded daemon WebSocket scenario fixture. */
export function loadAllDaemonWsFixtures(): DaemonWsFixture[] {
  return listDaemonWsScenarios().map((scenario) => loadDaemonWsFixture(scenario));
}

/** File names (without extension) for every recorded Pi UI Bridge kind fixture. */
export function listPiUiBridgeKinds(): string[] {
  return jsonFileNames(PI_UI_BRIDGE_DIR).map((name) => name.replace(/\.json$/, ""));
}

/** Loads one Pi UI Bridge kind fixture by kind name (e.g. "roster"). */
export function loadPiUiBridgeFixture(kind: string): PiUiBridgeFixture {
  const fileName = kind.endsWith(".json") ? kind : `${kind}.json`;
  return readJsonFile<PiUiBridgeFixture>(join(PI_UI_BRIDGE_DIR, fileName));
}

/** Loads every recorded Pi UI Bridge kind fixture. */
export function loadAllPiUiBridgeFixtures(): PiUiBridgeFixture[] {
  return listPiUiBridgeKinds().map((kind) => loadPiUiBridgeFixture(kind));
}
