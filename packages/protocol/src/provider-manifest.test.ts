import { describe, expect, it } from "vitest";
import {
  enrichModesWithUiMetadata,
  getModeVisuals,
  type AgentProviderDefinition,
} from "./provider-manifest.js";
import type { AgentMode } from "./agent-types.js";

// Provider runtime modes: the runtime list (from `fetchCatalog`) is the source
// of truth; static definitions only enrich missing UI metadata on top (see
// `provider-manifest.ts`'s boundary comment and `enrichModesWithUiMetadata`).

const definitions: AgentProviderDefinition[] = [
  {
    id: "pi",
    label: "Pi",
    description: "test provider",
    defaultModeId: "default",
    modes: [
      { id: "default", label: "Default", icon: "ShieldCheck", colorTier: "safe" },
      { id: "plan", label: "Plan", icon: "ShieldQuestionMark", colorTier: "planning" },
    ],
  },
];

describe("getModeVisuals", () => {
  it("returns the static visuals for a known mode", () => {
    expect(getModeVisuals("pi", "default", definitions)).toEqual({
      icon: "ShieldCheck",
      colorTier: "safe",
    });
  });

  it("returns undefined for an unknown mode", () => {
    expect(getModeVisuals("pi", "nope", definitions)).toBeUndefined();
  });

  it("returns undefined for an unknown provider", () => {
    expect(getModeVisuals("unknown", "default", definitions)).toBeUndefined();
  });
});

describe("enrichModesWithUiMetadata", () => {
  it("fills missing icon/colorTier from the static definition", () => {
    const runtimeModes: AgentMode[] = [{ id: "default", label: "Default" }];

    expect(enrichModesWithUiMetadata("pi", runtimeModes, definitions)).toEqual([
      { id: "default", label: "Default", icon: "ShieldCheck", colorTier: "safe" },
    ]);
  });

  it("keeps runtime values the provider already supplied", () => {
    const runtimeModes: AgentMode[] = [
      { id: "default", label: "Default", icon: "Custom", colorTier: "dangerous" },
    ];

    expect(enrichModesWithUiMetadata("pi", runtimeModes, definitions)).toEqual(runtimeModes);
  });

  it("fills only the missing half, keeping the runtime half", () => {
    const runtimeModes: AgentMode[] = [{ id: "plan", label: "Plan", icon: "Custom" }];

    expect(enrichModesWithUiMetadata("pi", runtimeModes, definitions)).toEqual([
      { id: "plan", label: "Plan", icon: "Custom", colorTier: "planning" },
    ]);
  });

  it("passes through a runtime mode the definition does not know", () => {
    const runtimeModes: AgentMode[] = [{ id: "runtime-only", label: "Runtime Only" }];

    expect(enrichModesWithUiMetadata("pi", runtimeModes, definitions)).toEqual(runtimeModes);
  });

  it("never reorders or drops runtime modes", () => {
    const runtimeModes: AgentMode[] = [
      { id: "runtime-only", label: "B" },
      { id: "default", label: "A" },
    ];

    const enriched = enrichModesWithUiMetadata("pi", runtimeModes, definitions);
    expect(enriched.map((mode) => mode.id)).toEqual(["runtime-only", "default"]);
  });

  it("does not mutate the input array", () => {
    const runtimeModes: AgentMode[] = [{ id: "default", label: "Default" }];
    const snapshot = structuredClone(runtimeModes);

    enrichModesWithUiMetadata("pi", runtimeModes, definitions);
    expect(runtimeModes).toEqual(snapshot);
  });
});
