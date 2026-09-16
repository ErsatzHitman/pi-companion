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

  it("gives every row a non-empty whereItDraws paragraph and at least one contract term", () => {
    for (const row of DRAWING_EXTENSIONS) {
      expect(row.whereItDraws.length).toBeGreaterThan(0);
      expect(row.contract.length).toBeGreaterThan(0);
      for (const { term, value } of row.contract) {
        expect(term.length).toBeGreaterThan(0);
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it("names each row's own channel as the first contract term", () => {
    // Every row's contract opens with its wire channel — the one fact
    // every extension in this list has in common.
    for (const row of DRAWING_EXTENSIONS) {
      expect(row.contract[0]?.term).toBe("channel");
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
