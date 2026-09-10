import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TAB_ROUTE_NAME } from "../../../../app-shell/host-tabs";
import { TOP_LEVEL_DESTINATIONS } from "../../../../app-shell/top-level-destinations";

/**
 * `HostTabsLayout` coverage — T32S1C. Source-level contract test, same
 * reason as `../../../../app-shell/navigation-shell.test.ts`: this module imports
 * `expo-router` (itself layered on `react-native`), which this
 * workspace's plain `vitest` setup can't render.
 */
describe("HostTabsLayout source", () => {
  const source = readFileSync(fileURLToPath(new URL("./_layout.tsx", import.meta.url)), "utf8");

  // Comment-stripped before matching (P5-W16 merge gate, applying the
  // pattern T57B filed against this file): an assertion run against raw
  // source can be satisfied -- or falsely tripped -- by prose in a doc
  // comment rather than by the real code it names.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("renders a <Tabs.Screen> for every TOP_LEVEL_DESTINATIONS entry, named by TAB_ROUTE_NAME", () => {
    expect(code).toMatch(/<Tabs\b/);
    expect(code).toMatch(/TOP_LEVEL_DESTINATIONS\.map/);
    expect(code).toMatch(/name=\{TAB_ROUTE_NAME\[destination\.type\]\}/);
    for (const destination of TOP_LEVEL_DESTINATIONS) {
      expect(TAB_ROUTE_NAME[destination.type]).toBeTruthy();
    }
  });

  it("T327: tells the tab navigator the bottom inset is already applied by the shell's SafeAreaView", () => {
    // Otherwise the tab bar pads for the navigation bar a second time.
    expect(code).toMatch(/safeAreaInsets = useMemo\(\(\) => \(\{ bottom: 0 \}\), \[\]\)/);
    expect(code).toMatch(
      /<Tabs screenOptions=\{screenOptions\} safeAreaInsets=\{safeAreaInsets\}>/,
    );
  });

  it("themes the tab bar through useTheme() rather than a raw hex literal", () => {
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).toMatch(/theme\.colors\./);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
