import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-level coverage for `VoiceVocabularySection`
 * (`./voice-vocabulary-section.tsx`), the settings section that manages
 * the user-maintained voice vocabulary.
 *
 * `react-native` component modules can't be rendered under this
 * workspace's plain `vitest` setup (the "RN-in-vitest limitation" this
 * repo's `CLAUDE.md` names) — like `../settings/SettingsScreen.test.ts`,
 * this statically verifies the source contracts a render pass would
 * otherwise check. The store and the repair pass the section drives are
 * unit tested for real in `voice-vocabulary-model.test.ts` (and their
 * application to transcripts in `voice-model.test.ts`).
 */
function readSectionSource(): string {
  return readFileSync(
    fileURLToPath(new URL("./voice-vocabulary-section.tsx", import.meta.url)),
    "utf8",
  );
}

/** Comment-stripped: this file's own doc comments quote several of the strings the assertions below look for. */
function readSectionCode(): string {
  return readSectionSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("VoiceVocabularySection source", () => {
  const code = readSectionCode();

  it("is a named, importable export taking the shared storage, never AsyncStorage directly", () => {
    expect(code).toMatch(/export function VoiceVocabularySection\(/);
    expect(code).toMatch(/storage: KeyValueStorage;/);
    expect(code).not.toMatch(/AsyncStorage/);
  });

  it("drives the voice vocabulary controller, never a second store of its own", () => {
    expect(code).toMatch(/createVoiceVocabularyController\(\{ storage \}\)/);
    expect(code).toMatch(/controller\.subscribe\(setSnapshot\)/);
    expect(code).toMatch(/void controller\.load\(\)/);
    expect(code).toMatch(/controller\.addWord\(draft\)/);
    expect(code).toMatch(/controller\.removeWord\(word\)/);
  });

  it("draws a labelled Voice section in the redesign's quiet style", () => {
    expect(code).toMatch(/<Section title="Voice"/);
    expect(code).toMatch(/variant="label"/);
  });

  it("takes the new word through the TextField primitive with the keyboard left off the canonical spelling", () => {
    expect(code).toMatch(/<TextField/);
    expect(code).toMatch(/label="New word or phrase"/);
    expect(code).toMatch(/autoCapitalize="none"/);
    expect(code).toMatch(/autoCorrect=\{false\}/);
  });

  it("surfaces each addWord rejection as a field error, never a generic failure", () => {
    expect(code).toMatch(/error=\{error \?\? undefined\}/);
    expect(code).toMatch(/That word is already in the list\./);
    expect(code).toMatch(/Type a word or phrase first\./);
  });

  it("adds through the Button primitive, disabled while the field is blank", () => {
    expect(code).toMatch(/<Button/);
    expect(code).toMatch(/label="Add"/);
    expect(code).toMatch(/disabled=\{draft\.trim\(\)\.length === 0\}/);
  });

  it("lists saved words as removable chips with an empty state, not a bare map", () => {
    expect(code).toMatch(/<ChipGroup accessibleName="Voice vocabulary words">/);
    expect(code).toMatch(/<Chip/);
    expect(code).toMatch(/onRemove=\{\(\) => void controller\.removeWord\(word\)\}/);
    expect(code).toMatch(/No custom words yet/);
  });

  it("explains an unreadable store with a Banner, mirroring SettingsScreen's own load-error row", () => {
    expect(code).toMatch(/\{snapshot\.loadError \? \(\s*<Banner/);
    expect(code).toMatch(/tone="info"/);
  });

  it("never imports a router — it is mounted by SettingsScreen, which owns navigation", () => {
    expect(code).not.toMatch(/from\s+["']expo-router["']/);
    expect(code).not.toMatch(/useRouter/);
  });

  it("uses only theme tokens for colour, never a raw hex literal", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).toMatch(/theme\.colors[.\[]/);
  });
});
