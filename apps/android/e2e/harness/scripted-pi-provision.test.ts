import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  SCRIPTED_PI_STUB_PATH,
  assertThrowawayHome,
  buildScriptedPiConfig,
  provisionScriptedPi,
  scenarioForFlow,
} from "./scripted-pi-provision.js";
import { SCRIPTED_PI_SCENARIO_ENV } from "./scripted-pi.mjs";

const NODE = path.resolve(os.tmpdir(), "fake-node");
const STUB = path.resolve(os.tmpdir(), "fake-scripted-pi.mjs");

describe("scenarioForFlow", () => {
  it("maps the two flows that need a scripted extension to their scenarios, and everything else to echo", () => {
    expect(scenarioForFlow("notification-approval")).toBe("approval");
    expect(scenarioForFlow("extension-sheets")).toBe("extension-sheets");
    for (const flow of ["smoke", "cold-start-restore", "pairing", "files-and-terminal", "nope"]) {
      expect(scenarioForFlow(flow)).toBe("echo");
    }
  });
});

describe("buildScriptedPiConfig", () => {
  it("is the persisted-config shape the daemon reads: version 1, agents.providers.pi.command = [node, stub], env carrying the scenario", () => {
    expect(
      buildScriptedPiConfig({ nodeBinary: NODE, stubPath: STUB, scenario: "approval" }),
    ).toEqual({
      version: 1,
      agents: {
        providers: {
          pi: {
            command: [NODE, STUB],
            env: { [SCRIPTED_PI_SCENARIO_ENV]: "approval" },
          },
        },
      },
    });
  });

  it("refuses an unknown scenario and a relative path (the daemon resolves a replaced command by existence, never PATH)", () => {
    expect(() =>
      buildScriptedPiConfig({ nodeBinary: NODE, stubPath: STUB, scenario: "bogus" as never }),
    ).toThrow(/bogus/);
    expect(() =>
      buildScriptedPiConfig({ nodeBinary: "node", stubPath: STUB, scenario: "echo" }),
    ).toThrow(/absolute/);
  });

  it("SCRIPTED_PI_STUB_PATH is the real, absolute path of scripted-pi.mjs beside this file", async () => {
    expect(path.isAbsolute(SCRIPTED_PI_STUB_PATH)).toBe(true);
    expect(path.basename(SCRIPTED_PI_STUB_PATH)).toBe("scripted-pi.mjs");
    expect((await stat(SCRIPTED_PI_STUB_PATH)).isFile()).toBe(true);
  });
});

describe("assertThrowawayHome", () => {
  const tmp = os.tmpdir();

  it("accepts exactly the shape daemon-endpoint.ts mints", () => {
    expect(() =>
      assertThrowawayHome(path.join(tmp, "picompanion-maestro-home-abc123", ".paseo"), tmp),
    ).not.toThrow();
  });

  it("refuses the owner's real home and anything outside the temp directory or off-pattern", () => {
    expect(() => assertThrowawayHome(path.join(os.homedir(), ".paseo"), tmp)).toThrow(/Refusing/);
    expect(() => assertThrowawayHome(path.join(tmp, ".paseo"), tmp)).toThrow(/Refusing/);
    expect(() =>
      assertThrowawayHome(path.join(tmp, "picompanion-maestro-home-abc", "paseo"), tmp),
    ).toThrow(/Refusing/);
    expect(() => assertThrowawayHome(path.join(tmp, "other-abc", ".paseo"), tmp)).toThrow(
      /Refusing/,
    );
    expect(() =>
      assertThrowawayHome(path.join(tmp, "..", "picompanion-maestro-home-abc", ".paseo"), tmp),
    ).toThrow(/Refusing/);
  });
});

describe("provisionScriptedPi", () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("creates the home leaf and writes config.json into it for the flow's scenario", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "picompanion-maestro-home-"));
    created.push(root);
    const paseoHome = path.join(root, ".paseo");

    const result = await provisionScriptedPi(paseoHome, "extension-sheets", {
      nodeBinary: NODE,
      stubPath: STUB,
    });

    expect(result).toEqual({
      configPath: path.join(paseoHome, "config.json"),
      scenario: "extension-sheets",
    });
    const parsed = JSON.parse(await readFile(result.configPath, "utf8")) as ReturnType<
      typeof buildScriptedPiConfig
    >;
    expect(parsed).toEqual(
      buildScriptedPiConfig({ nodeBinary: NODE, stubPath: STUB, scenario: "extension-sheets" }),
    );
  });

  it("defaults to this process's node and the real stub path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "picompanion-maestro-home-"));
    created.push(root);
    const paseoHome = path.join(root, ".paseo");

    const result = await provisionScriptedPi(paseoHome, "smoke");
    const parsed = JSON.parse(await readFile(result.configPath, "utf8")) as ReturnType<
      typeof buildScriptedPiConfig
    >;
    expect(parsed.agents.providers.pi.command).toEqual([process.execPath, SCRIPTED_PI_STUB_PATH]);
    expect(parsed.agents.providers.pi.env[SCRIPTED_PI_SCENARIO_ENV]).toBe("echo");
  });

  it("never writes outside a throwaway home", async () => {
    await expect(provisionScriptedPi(path.join(os.homedir(), ".paseo"), "smoke")).rejects.toThrow(
      /Refusing/,
    );
  });
});
