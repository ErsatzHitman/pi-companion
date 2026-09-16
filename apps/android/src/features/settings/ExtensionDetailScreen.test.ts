import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DRAWING_EXTENSIONS } from "./settings-extension-coverage";

/**
 * ANDROID-EXT-1 source-level coverage for `ExtensionDetailScreen.tsx`.
 *
 * `react-native` component modules can't be rendered under this
 * workspace's plain `vitest` setup (the "RN-in-vitest limitation" this
 * repo's `CLAUDE.md` names, and the same reason `SettingsScreen.test.ts`
 * and `DevicesScreen.test.ts` are source-level too) — this statically
 * verifies the source contracts a render pass would otherwise check.
 * The row data itself (`whereItDraws`/`contract`) is unit tested
 * directly in `settings-extension-coverage.test.ts`.
 */
function readScreenSource(): string {
  return readFileSync(
    fileURLToPath(new URL("./ExtensionDetailScreen.tsx", import.meta.url)),
    "utf8",
  );
}

function readScreenCode(): string {
  return readScreenSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("ExtensionDetailScreen source", () => {
  const code = readScreenCode();

  it("is a named, importable export taking a bare name prop", () => {
    expect(code).toMatch(/export function ExtensionDetailScreen\(/);
    expect(code).toMatch(/name:\s*string;/);
  });

  it("looks the row up from the static DRAWING_EXTENSIONS table, never a runtime registry", () => {
    expect(code).toMatch(/import \{ DRAWING_EXTENSIONS \} from "\.\/settings-extension-coverage";/);
    expect(code).toMatch(/DRAWING_EXTENSIONS\.find\(\(candidate\) => candidate\.name === name\)/);
    expect(code).not.toMatch(/from\s+["'].*registry["']/);
  });

  it("opens with the shared ScreenBar and an optional back action", () => {
    expect(code).toMatch(/<ScreenBar\b/);
    expect(code).toMatch(/leading=\{\s*onBack\s*\?/);
  });

  it("renders the Where it draws card from the row's own prose", () => {
    expect(code).toMatch(/title="Where it draws"/);
    expect(code).toMatch(/\{row\.whereItDraws\}/);
  });

  it("renders the Contract card as term/value rows from the row's own contract array", () => {
    expect(code).toMatch(/title="Contract"/);
    expect(code).toMatch(/row\.contract\.map\(/);
    expect(code).toMatch(/\{entry\.term\}/);
    expect(code).toMatch(/\{entry\.value\}/);
  });

  it("renders an honest not-found card when name matches no row, rather than a blank screen", () => {
    expect(code).toMatch(/title="Not found"/);
    expect(code).not.toMatch(/throw new Error/);
  });

  it("uses only theme tokens for colour, never a raw hex literal", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).toMatch(/theme\.colors\./);
  });
});

describe("ExtensionDetailScreen: every real row resolves", () => {
  it("has data for every DRAWING_EXTENSIONS row the screen could actually be opened with", () => {
    // A row press in SettingsScreen always passes one of DRAWING_EXTENSIONS'
    // own `name`s (ANDROID-EXT-1), so the lookup this screen performs
    // must succeed for every one of them — the "not found" branch is
    // reachable only through a name no real row press can produce.
    expect(DRAWING_EXTENSIONS.length).toBe(12);
    for (const row of DRAWING_EXTENSIONS) {
      const found = DRAWING_EXTENSIONS.find((candidate) => candidate.name === row.name);
      expect(found).toBe(row);
    }
  });
});
