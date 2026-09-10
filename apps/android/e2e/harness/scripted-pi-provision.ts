/**
 * T334 — points the isolated daemon's `pi` provider at
 * `./scripted-pi.mjs` before `run-flow.ts` starts the daemon, through the
 * one mechanism the daemon already has for it: `config.json` in
 * `PASEO_HOME`, whose `agents.providers.<id>` block
 * (`packages/server/src/server/persisted-config.ts`'s
 * `PersistedConfigSchema`, `packages/protocol/src/provider-config.ts`'s
 * `ProviderOverrideSchema`) may replace a provider's `command` argv and
 * add `env`. `packages/server/src/server/config.ts` turns that into the
 * provider's `runtimeSettings` (`command: { mode: "replace", argv }`),
 * and `providers/pi/runtime.ts`'s `buildPiLaunch` then spawns
 * `argv[0] argv[1..] --mode rpc ...` -- so the daemon's availability
 * check (`provider-launch-config.ts`'s `checkProviderLaunchAvailable`,
 * which resolves an absolute `argv[0]` by existence) and its session
 * start both go through exactly the code a real `pi` would.
 *
 * Nothing here can touch the owner's real home: the only directory this
 * module writes into is the `paseoHome` it is handed, which
 * `daemon-endpoint.ts` mints fresh under `os.tmpdir()` per run.
 * `provisionScriptedPi` refuses anything else by construction -- see
 * `assertThrowawayHome`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SCRIPTED_PI_SCENARIO,
  SCRIPTED_PI_SCENARIO_ENV,
  SCRIPTED_PI_SCENARIOS,
} from "./scripted-pi.mjs";

export type ScriptedPiScenario = "echo" | "approval" | "extension-sheets";

export const SCRIPTED_PI_STUB_PATH = fileURLToPath(new URL("./scripted-pi.mjs", import.meta.url));

/**
 * Which stub scenario each flow needs. Every flow not named here gets
 * `echo`: a session that can be created and opened, with turns that
 * finish, is all the rest of them need from a provider.
 */
const SCENARIO_BY_FLOW: Readonly<Record<string, ScriptedPiScenario>> = {
  "notification-approval": "approval",
  "extension-sheets": "extension-sheets",
};

export function scenarioForFlow(flowName: string): ScriptedPiScenario {
  return SCENARIO_BY_FLOW[flowName] ?? (DEFAULT_SCRIPTED_PI_SCENARIO as ScriptedPiScenario);
}

export interface ScriptedPiConfigInput {
  /** The node binary the daemon should spawn; `process.execPath` in `run-flow.ts`. */
  nodeBinary: string;
  /** Absolute path of `scripted-pi.mjs`; `SCRIPTED_PI_STUB_PATH` in `run-flow.ts`. */
  stubPath: string;
  scenario: ScriptedPiScenario;
}

/** The exact `config.json` document `provisionScriptedPi` writes. */
export function buildScriptedPiConfig(input: ScriptedPiConfigInput): {
  version: 1;
  agents: {
    providers: {
      pi: { command: [string, string]; env: Record<string, string> };
    };
  };
} {
  if (!(SCRIPTED_PI_SCENARIOS as readonly string[]).includes(input.scenario)) {
    throw new Error(
      `Unknown scripted pi scenario "${input.scenario}" (expected one of ${SCRIPTED_PI_SCENARIOS.join(", ")})`,
    );
  }
  if (!path.isAbsolute(input.nodeBinary) || !path.isAbsolute(input.stubPath)) {
    throw new Error(
      "scripted pi provisioning needs absolute paths: the daemon resolves a replaced provider " +
        `command by existence, never through PATH (got ${input.nodeBinary}, ${input.stubPath})`,
    );
  }
  return {
    version: 1,
    agents: {
      providers: {
        pi: {
          command: [input.nodeBinary, input.stubPath],
          env: { [SCRIPTED_PI_SCENARIO_ENV]: input.scenario },
        },
      },
    },
  };
}

/**
 * The only homes this module will write into are the throwaway ones
 * `daemon-endpoint.ts` creates: under `os.tmpdir()`, with its
 * `picompanion-maestro-home-` prefix, ending in `.paseo`. The owner's real
 * `~/.paseo` (or a `PASEO_HOME` pointing anywhere else) fails this check.
 */
export function assertThrowawayHome(paseoHome: string, tmpdir: string = os.tmpdir()): void {
  const resolved = path.resolve(paseoHome);
  const root = path.resolve(tmpdir);
  const relative = path.relative(root, resolved);
  const insideTmp = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  const parent = path.basename(path.dirname(resolved));
  if (
    !insideTmp ||
    path.basename(resolved) !== ".paseo" ||
    !parent.startsWith("picompanion-maestro-home-")
  ) {
    throw new Error(
      `Refusing to provision a scripted pi into ${paseoHome}: only a fresh ` +
        `${path.join(root, "picompanion-maestro-home-*", ".paseo")} from daemon-endpoint.ts is ever written to`,
    );
  }
}

export interface ProvisionedScriptedPi {
  configPath: string;
  scenario: ScriptedPiScenario;
}

export async function provisionScriptedPi(
  paseoHome: string,
  flowName: string,
  options: { nodeBinary?: string; stubPath?: string; tmpdir?: string } = {},
): Promise<ProvisionedScriptedPi> {
  assertThrowawayHome(paseoHome, options.tmpdir);
  const scenario = scenarioForFlow(flowName);
  const config = buildScriptedPiConfig({
    nodeBinary: options.nodeBinary ?? process.execPath,
    stubPath: options.stubPath ?? SCRIPTED_PI_STUB_PATH,
    scenario,
  });
  // The daemon chmods this file to 0600 on read (`ensurePrivateFile`);
  // writing it that way from the start just means there is nothing for
  // it to fix.
  await mkdir(paseoHome, { recursive: true, mode: 0o700 });
  const configPath = path.join(paseoHome, "config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return { configPath, scenario };
}
