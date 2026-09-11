import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeFontFamilyNames } from "@picompanion/design-tokens";
import { describe, expect, it } from "vitest";

/**
 * T13C (docs/issues-from-plan.md "Bundle Inter/Geist Mono and complete
 * light-theme values"): asserts the Android font registration lists both
 * families and that every `require(...)`d asset is a real file on disk.
 *
 * `apps/android` renders React Native components that can't be mounted
 * under plain vitest (see `component-lab.test.ts`'s note), so — like that
 * file — this is a static-source contract test rather than a render test:
 * it parses `fonts.ts`'s own source for its `useFonts({...})` registration
 * keys and `require(...)` targets, resolves each target against the
 * filesystem, and cross-checks the registration keys against
 * `nativeFontFamilyNames` (the same source `native.ts` resolves a theme's
 * `fontFamily` from), so a mismatch between "the name the theme resolves
 * to" and "the name actually registered" — the specific Android-only gap
 * this task closes — would fail here.
 */

const fontsTsPath = fileURLToPath(new URL("./fonts.ts", import.meta.url));
const fontsTsDir = dirname(fontsTsPath);
const fontsTsSource = readFileSync(fontsTsPath, "utf8");

function extractRequirePaths(source: string): string[] {
  return [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1] ?? "");
}

describe("apps/android font bundling (T13C)", () => {
  it("loads fonts through expo-font's useFonts, not a lazy/optional path", () => {
    expect(fontsTsSource).toContain('from "expo-font"');
    expect(fontsTsSource).toContain("useFonts(");
  });

  it("registers every nativeFontFamilyNames key across both families", () => {
    // `fonts.ts` computes its `useFonts({...})` keys from
    // `nativeFontFamilyNames` rather than duplicating literal name strings
    // (so the two can never drift), so this checks for a reference to each
    // weight of both families rather than the literal registered string.
    for (const weight of ["regular", "medium", "semibold", "bold"] as const) {
      expect(fontsTsSource).toContain(`nativeFontFamilyNames.sans.${weight}`);
      expect(fontsTsSource).toContain(`nativeFontFamilyNames.mono.${weight}`);
    }
    // Both families, not just one — the literal gap-analysis requirement.
    expect(fontsTsSource).toContain("nativeFontFamilyNames.sans");
    expect(fontsTsSource).toContain("nativeFontFamilyNames.mono");
    // And the registered names really are what the theme resolves against.
    const allNames = [
      ...Object.values(nativeFontFamilyNames.sans),
      ...Object.values(nativeFontFamilyNames.mono),
    ];
    expect(allNames.length).toBe(8);
    expect(new Set(allNames).size).toBe(8);
  });

  it("every require()'d font asset resolves to a real .ttf file on disk", () => {
    const requirePaths = extractRequirePaths(fontsTsSource).filter((p) => p.endsWith(".ttf"));
    expect(requirePaths.length).toBe(8);
    for (const relativePath of requirePaths) {
      const absolute = resolve(fontsTsDir, relativePath);
      expect(existsSync(absolute), `expected ${relativePath} to exist on disk`).toBe(true);
      expect(statSync(absolute).size).toBeGreaterThan(1000);
    }
  });

  it("registers four Inter weights and four JetBrains Mono weights (T345)", () => {
    const requirePaths = extractRequirePaths(fontsTsSource);
    const interPaths = requirePaths.filter((p) => p.includes("Inter-"));
    const monoPaths = requirePaths.filter((p) => p.includes("JetBrainsMono-"));
    expect(interPaths.length).toBe(4);
    expect(monoPaths.length).toBe(4);
  });

  it("vendors the OFL license text alongside each family's assets", () => {
    expect(existsSync(resolve(fontsTsDir, "../../../assets/fonts/OFL-Inter.txt"))).toBe(true);
    expect(existsSync(resolve(fontsTsDir, "../../../assets/fonts/OFL-JetBrainsMono.txt"))).toBe(
      true,
    );
  });

  /**
   * T367 — the face name the app dropped, and the sweep that has to stay
   * swept.
   *
   * T345 swapped Android's mono face from Geist Mono to JetBrains Mono.
   * Seven comments across `apps/android/src` still explained a mono
   * `fontFamily` by quoting `docs/beautiful-ui-reference.md`'s own "Geist
   * Mono for all numerals" — a reference-only document, so the citation
   * is legitimate PROVENANCE under `CLAUDE.md`'s T253 test, but the face
   * name in it stopped describing this app. `HANDOFF.md` §9.3 listed all
   * seven; T356 reworded six while restyling the transcript, and the
   * extension `progress` renderer's was still standing at T367.
   *
   * Rewording the seventh is one line. What this case adds is the part
   * that was missing both times: nothing could tell whether the sweep was
   * complete, so the next reader had to re-grep the tree and hand-classify
   * every hit — which is exactly how six got fixed and one did not. The
   * walk below does that classification once, in code.
   *
   * A mention is allowed only where the surrounding text marks it as
   * history — the same `HISTORICAL_QUOTE_MARKERS` idea
   * `scripts/ci/guard-capability-prose.mjs` uses, and for the same
   * reason: the corrections T356 and T367 wrote have to quote the wrong
   * name verbatim to explain what was wrong, and a naive substring check
   * would fail against its own fix.
   */
  it("no live comment explains an Android style by naming the face T345 dropped (T367)", () => {
    const srcRoot = resolve(fontsTsDir, "../..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
      }
    };
    walk(srcRoot);
    // The walk has to actually reach the tree, or this case passes by
    // finding nothing — the "check that cannot fail" shape `CLAUDE.md`
    // names in three separate sections.
    expect(files.length).toBeGreaterThan(200);

    const HISTORY = /(used to|this said|previously said|no longer|swapped|CORRECTED|wrong on)/i;
    const live: string[] = [];
    for (const file of files) {
      if (file === fileURLToPath(new URL("./fonts.test.ts", import.meta.url))) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/Geist[\s*/]*Mono/g)) {
        // The whole sentence around the hit, not one physical line: every
        // one of these comments wraps, and T356's own corrections put the
        // marker on a different line than the quoted name.
        const window = text.slice(
          Math.max(0, (match.index ?? 0) - 400),
          (match.index ?? 0) + match[0].length + 200,
        );
        if (!HISTORY.test(window)) live.push(`${file}: ${window.slice(300, 500)}`);
      }
    }
    expect(
      live,
      `a comment still names Geist Mono as this app's face:\n${live.join("\n")}`,
    ).toEqual([]);
  });

  it("gates the root layout's first paint on fontsLoaded/fontError", () => {
    // Comment-stripped (T130): `_layout.tsx`'s own doc comment quotes
    // both `useAppFonts()` and `fontsLoaded` verbatim, so an unanchored
    // `toContain` against raw file text is satisfied by that prose alone
    // and stays green even when the real gate is deleted.
    const rawLayoutSource = readFileSync(resolve(fontsTsDir, "../../app/_layout.tsx"), "utf8");
    const layoutSource = rawLayoutSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(layoutSource).toContain("useAppFonts");
    expect(layoutSource).toContain("fontsLoaded");
  });
});
