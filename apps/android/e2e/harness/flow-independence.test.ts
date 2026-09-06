import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkFlowIndependence } from "./flow-independence.js";
import { listExitGateFlowNames } from "./shard-plan.js";

const MAESTRO_DIR = fileURLToPath(new URL("../../maestro/", import.meta.url));
const TEN_FLOWS = listExitGateFlowNames();

describe("checkFlowIndependence — the checker itself, proven on fixtures", () => {
  it("passes a flow whose first launchApp step clears state", () => {
    const yaml = [
      "appId: x",
      "---",
      "- launchApp:",
      "    clearState: true",
      "    clearKeychain: true",
      "",
    ].join("\n");
    expect(checkFlowIndependence(yaml)).toEqual({
      hasLaunchApp: true,
      firstLaunchAppClearsState: true,
    });
  });

  it("MUTATION: a flow whose first launchApp step omits clearState is caught", () => {
    const yaml = ["appId: x", "---", "- launchApp:", "    clearKeychain: true", ""].join("\n");
    expect(checkFlowIndependence(yaml).firstLaunchAppClearsState).toBe(false);
  });

  it("MUTATION: a bare `launchApp` mention inside a doc-comment does not satisfy the check", () => {
    // This is exactly the shape every real flow file's own doc comment
    // has (prose like "on the FIRST `launchApp` only") -- proving this
    // module isn't fooled by defect class #1/#4 from CLAUDE.md's
    // "source-text assertions" catalogue.
    const yaml = [
      "appId: x",
      "# clearState/clearKeychain make this launchApp independent",
      "---",
      "- launchApp:",
      "    clearKeychain: true",
      "",
    ].join("\n");
    expect(checkFlowIndependence(yaml).firstLaunchAppClearsState).toBe(false);
  });

  it("reports no launchApp step at all when the file has none", () => {
    expect(checkFlowIndependence("appId: x\n---\n- assertVisible: foo\n")).toEqual({
      hasLaunchApp: false,
      firstLaunchAppClearsState: false,
    });
  });

  it("checks only the FIRST launchApp — a legitimate later one may omit clearState", () => {
    const yaml = [
      "- launchApp:",
      "    clearState: true",
      "    clearKeychain: true",
      "- killApp",
      "- launchApp:",
      "    label: restore, deliberately not clearing state",
      "",
    ].join("\n");
    expect(checkFlowIndependence(yaml).firstLaunchAppClearsState).toBe(true);
  });
});

describe("every real §14.4 flow file starts with clearState: true", () => {
  it("covers all ten flows (fails loudly if the real set drifts)", () => {
    expect(TEN_FLOWS).toHaveLength(10);
  });

  it.each(TEN_FLOWS)("%s.yaml's first launchApp step clears state", (flowName) => {
    const yamlPath = path.join(MAESTRO_DIR, `${flowName}.yaml`);
    const text = readFileSync(yamlPath, "utf8");
    const result = checkFlowIndependence(text);
    expect(result.hasLaunchApp).toBe(true);
    expect(result.firstLaunchAppClearsState).toBe(true);
  });
});
