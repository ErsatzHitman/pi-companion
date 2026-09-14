import { describe, expect, it } from "vitest";

import {
  DRAWING_EXTENSIONS,
  SILENT_EXTENSION_NAMESPACES,
  silentExtensionsSummary,
} from "./settings-extension-coverage";

describe("settings-extension-coverage", () => {
  it("lists every plan.md §11.7 first-class-UI extension, with no duplicates", () => {
    const names = DRAWING_EXTENSIONS.map((row) => row.name);
    expect(names).toEqual([
      "loop",
      "btw",
      "subagents",
      "todo",
      "advisor",
      "switchboard",
      "workflows",
      "minimal-status",
      "plan-mode",
      "pi-goal",
      "prompt-arbitrage",
      "ask-user",
    ]);
    expect(new Set(names).size).toBe(names.length);
    for (const row of DRAWING_EXTENSIONS) {
      expect(row.description.length).toBeGreaterThan(0);
    }
  });

  it("lists every plan.md §11.7 headless/backend-only extension, with no duplicates and no overlap with the drawing list", () => {
    expect(new Set(SILENT_EXTENSION_NAMESPACES).size).toBe(SILENT_EXTENSION_NAMESPACES.length);
    const drawingNames = new Set(DRAWING_EXTENSIONS.map((row) => row.name));
    for (const name of SILENT_EXTENSION_NAMESPACES) {
      expect(drawingNames.has(name)).toBe(false);
    }
  });

  it("summarizes the silent list as one sentence naming every namespace", () => {
    const summary = silentExtensionsSummary();
    for (const name of SILENT_EXTENSION_NAMESPACES) {
      expect(summary).toContain(name);
    }
    expect(summary).toMatch(/change what the agent can do/);
  });
});
