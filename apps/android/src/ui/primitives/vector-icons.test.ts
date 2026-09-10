import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `vector-icons.tsx` source-level contract test — same reason as
 * `./Portal.test.ts` and `../../app-shell/session-nav-actions.test.ts`:
 * the module imports `react-native-svg`, so it cannot be rendered under
 * this workspace's plain `vitest` setup (see this repository's
 * `CLAUDE.md`). What is worth pinning here is not React behaviour but
 * the DRAWING: each `d` attribute is the design artifact's own path,
 * and a typo in one is invisible to a typecheck, to a lint, and to
 * every other test in this app.
 *
 * `readCode()` strips comments first, so a path quoted in a doc comment
 * can never satisfy an assertion below.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./vector-icons.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("VectorIcon source", () => {
  it("draws each icon with the design artifact's own path data", () => {
    const code = readCode();
    expect(code).toMatch(/d="M12 5v14M5 12h14"/);
    expect(code).toMatch(/d="M5\.5 11a6\.5 6\.5 0 0 0 13 0M12 17\.5v3\.5M9 21h6"/);
    expect(code).toMatch(/d="M12 19V5M5\.5 11\.5 12 5l6\.5 6\.5"/);
    expect(code).toMatch(/d="M12 2l2\.4 7\.2L22 12l-7\.6 2\.8L12 22l-2\.4-7\.2L2 12l7\.6-2\.8z"/);
    expect(code).toMatch(/d="M6 9l6 6 6-6"/);
    expect(code).toMatch(/d="M4 12\.5 9\.5 18 20 6\.5"/);
    expect(code).toMatch(/d="M21 21l-4\.3-4\.3"/);
  });

  it("keeps the artifact's per-icon stroke weights, which differ and are not interchangeable", () => {
    const code = readCode();
    // plus 2.2, mic 2, send 2.4, chevron 2.2, check 2.6, search 2.
    expect(code).toMatch(/d="M12 5v14M5 12h14" stroke=\{color\} strokeWidth=\{2\.2\}/);
    expect(code).toMatch(
      /d="M12 19V5M5\.5 11\.5 12 5l6\.5 6\.5"\s*\n?\s*stroke=\{color\}\s*\n?\s*strokeWidth=\{2\.4\}/,
    );
    expect(code).toMatch(
      /d="M4 12\.5 9\.5 18 20 6\.5"\s*\n?\s*stroke=\{color\}\s*\n?\s*strokeWidth=\{2\.6\}/,
    );
  });

  it("fills the sparkle and strokes nothing else, matching the artifact's one filled icon", () => {
    const code = readCode();
    expect(code).toMatch(/M12 2l2\.4 7\.2[^"]*" fill=\{color\}/);
  });

  it("hides every icon from assistive tech, so the accessible name always comes from the host control", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityElementsHidden/);
    expect(code).toMatch(/importantForAccessibility="no-hide-descendants"/);
  });

  it("takes its colour from the caller and never hardcodes a product colour", () => {
    const code = readCode();
    expect(code).toMatch(/color: string;/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });

  it("renders one 24-viewBox Svg per icon, so every path shares the artifact's coordinate space", () => {
    const code = readCode();
    expect(code).toMatch(/const VIEW_BOX = "0 0 24 24";/);
    expect(code).toMatch(/viewBox=\{VIEW_BOX\}/);
  });
});
