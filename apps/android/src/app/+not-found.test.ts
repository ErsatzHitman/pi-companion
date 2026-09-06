import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `NotFoundRoute` (`+not-found.tsx`) coverage — T32S2: "An invalid link
 * lands on an explained fallback screen." Source-level contract test,
 * same reason as `../app-shell/navigation-shell.test.ts`: this module
 * imports `expo-router`/`react-native`.
 */
describe("+not-found source", () => {
  const source = readFileSync(fileURLToPath(new URL("./+not-found.tsx", import.meta.url)), "utf8");

  // Comment-stripped before matching (P5-W16 merge gate, applying the
  // pattern T57B filed against this file): an assertion run against raw
  // source can be satisfied -- or falsely tripped -- by prose in a doc
  // comment rather than by the real code it names.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("has a default export, so Expo Router accepts it as this reserved fallback route", () => {
    expect(code).toMatch(/export default function NotFoundRoute/);
  });

  it("names the attempted path in the rendered explanation, not just a generic 404", () => {
    expect(code).toMatch(/isn't a screen in Pi Companion/);
    expect(code).toMatch(/match\.path/);
  });

  it("offers a way out, back to /connect", () => {
    expect(code).toMatch(/href="\/connect"/);
  });

  it("resolves every colour through useTheme()", () => {
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).toMatch(/theme\.colors\./);
  });

  it('contains no raw hex colour literal (plan.md §10 "no raw hex" rule)', () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
