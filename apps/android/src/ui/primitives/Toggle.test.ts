import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UI-A2 source-level contract for `Toggle.tsx`. The primitive imports
 * `react-native`/`react-native-reanimated`, so it cannot render under
 * this workspace's plain `vitest` setup (the same constraint
 * `Sheet.test.ts`'s doc comment names); `readCode()` strips comments
 * first, so a claim made only in a doc comment can never satisfy an
 * assertion.
 *
 * CORRECTED (A-SIZE): this file used to pin `TRACK_WIDTH` at `40` under
 * the title "matches the reference's own `.sw` (UI-A2: 40, not 44)" —
 * backwards from the confirmed spec. Grepped directly against the
 * confirmed Android design, the real rule
 * is `.sw{width:44px;height:26px;...}`; nothing in that file's `.sw`
 * selector or its `.sw i` knob rule says `40` anywhere.
 * `docs/ui-reference/pi-companion-app.html` is the likely source of the
 * old, wrong `40`: it is a reconstruction that does NOT match the
 * confirmed Android design — the two files' md5s differ
 * (`3ff70c21a0b512f169bad358608144f0` against the confirmed design's
 * `498c3bd38ac8da0636e0bc05b705a7be`), measured directly. But this file
 * cites no path, so the provenance is inference, not confirmed. (CORRECTED,
 * AND-SHELL: this said "see `CLAUDE.md`'s warning that it is a stale
 * reconstruction". `CLAUDE.md` says nothing about `docs/ui-reference/` at
 * all — grepped, not assumed — so that was a citation of repository law
 * that does not exist. The measured md5 difference above is the real
 * evidence, and it is stated here rather than attributed elsewhere.) The 40/44 confusion is corrected
 * here rather than merely reported, because this repository's own rule
 * (`CLAUDE.md`, "reference-only documents") treats an assertion this
 * concretely falsifiable, once it is caught, as a defect to fix rather
 * than a historical curiosity to preserve.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./Toggle.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Toggle: track dimensions match the reference's own .sw (A-SIZE: 44x26, not 40x24)", () => {
  it("declares TRACK_WIDTH as 44", () => {
    expect(readCode()).toMatch(/const TRACK_WIDTH = 44;/);
  });

  it("declares TRACK_HEIGHT as 26", () => {
    expect(readCode()).toMatch(/const TRACK_HEIGHT = 26;/);
  });

  it("draws the track at TRACK_WIDTH x TRACK_HEIGHT, not second, independent numbers", () => {
    expect(readCode()).toMatch(/track: \{\s*width: TRACK_WIDTH,\s*height: TRACK_HEIGHT,/);
  });
});

describe("Toggle: knob dimensions match the reference's own .sw i (A-SIZE: 18dp knob, 4dp inset, not 20dp/3dp)", () => {
  it("declares KNOB_SIZE as 18", () => {
    expect(readCode()).toMatch(/const KNOB_SIZE = 18;/);
  });

  it("declares KNOB_INSET as 4", () => {
    expect(readCode()).toMatch(/const KNOB_INSET = 4;/);
  });

  it("draws the knob at KNOB_SIZE x KNOB_SIZE, not second, independent numbers", () => {
    expect(readCode()).toMatch(/knob: \{\s*width: KNOB_SIZE,\s*height: KNOB_SIZE,/);
  });

  it("slides the knob to the reference's on-state left:22px (KNOB_INSET + (TRACK_WIDTH - KNOB_SIZE - KNOB_INSET * 2))", () => {
    // 4 + 1 * (44 - 18 - 4*2) === 22, the spec's `.sw[data-on="on"] i{left:22px}`.
    expect(readCode()).toMatch(
      /translateX: KNOB_INSET \+ progress\.value \* \(TRACK_WIDTH - KNOB_SIZE - KNOB_INSET \* 2\),/,
    );
  });
});

describe('Toggle: knob recolours with progress, matching the spec\'s .sw i / .sw[data-on="on"] i', () => {
  it("drives the knob's backgroundColor from progress, in knobStyle, not a static style value", () => {
    const code = readCode();
    expect(code).toMatch(
      /backgroundColor: progress\.value > 0\.5 \? theme\.colors\.accentContrast : theme\.colors\["ink-2"\],/,
    );
    expect(code).not.toMatch(/knob: \{[^}]*backgroundColor/);
  });
});

describe("Toggle: keeps its 48dp touch floor around the visually smaller track", () => {
  it("declares a 48dp minimum on both axes of the touch area", () => {
    expect(readCode()).toMatch(
      /touchArea: \{ minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center" \}/,
    );
  });
});

describe("Toggle: reads every colour from the theme and hardcodes no product colour", () => {
  it("calls useTheme() and never a raw hex or rgba literal", () => {
    const code = readCode();
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });
});
