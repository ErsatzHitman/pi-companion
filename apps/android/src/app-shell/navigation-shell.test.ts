import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T32S1 `NavigationShell` coverage. Source-level contract test — same
 * reason as `./compact-shell.test.ts` and `../app/dev/component-lab.test.ts`:
 * this module imports `expo-router` (itself layered on `react-native`),
 * which this workspace's plain `vitest` setup can't load.
 */
describe("NavigationShell source", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./navigation-shell.tsx", import.meta.url)),
    "utf8",
  );
  /**
   * `source` with comments stripped, matching the precedent in
   * `../app/h/[serverId]/session/[agentId]/index.test.ts` (`readCode()`)
   * and `../features/files/files-screen.test.ts` (`readScreenCode()`):
   * `navigation-shell.tsx`'s own doc comment quotes the very JSX tags the
   * structural assertion below looks for, so a regex run over the raw
   * text can be satisfied by prose instead of by the render tree.
   * Assertions that must reach real code read this instead of `source`.
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("renders Expo Router's <Stack> so it picks up whatever routes the filesystem declares", () => {
    expect(code).toMatch(/<Stack\b/);
    expect(code).toMatch(/from "expo-router"/);
  });

  it("hides the native header on every screen (product supplies its own via CompactSessionShell's header slot)", () => {
    expect(code).toMatch(/headerShown:\s*false/);
  });

  it("themes the screen background through useTheme() rather than a raw hex literal", () => {
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).toMatch(/theme\.colors\.page/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("T32S6: wraps <Stack> in <PortalHost> from ui/primitives, so a Sheet has a host to render into", () => {
    // A full JSX opening-tag match, not a bare `PortalHost` identifier —
    // that identifier also appears in this file's own `import` line, so
    // an unanchored match against it alone would stay green even if the
    // real wrapping JSX were deleted (CLAUDE.md's "bare identifier"
    // defect). This instead requires <PortalHost> to actually wrap
    // <Stack ...> as a child.
    //
    // P5-W10 merge gate: this must run over `code`, not `code`.
    // Against `code` the assertion was mutation-blind:
    // `navigation-shell.tsx`'s own doc comment contains `<PortalHost>`
    // and, further down, `<Stack>`, so the lazy spans could bridge from
    // those two comment tokens to the real `</PortalHost>`. Rewriting
    // the render tree to `<><PortalHost></PortalHost><Stack .../></>` —
    // Stack a sibling of an empty host, i.e. exactly the defect this
    // test names — still passed. Over `code` only real JSX can satisfy it.
    expect(code).toMatch(/from "\.\.\/ui\/primitives"/);
    expect(code).toMatch(/<PortalHost>[\s\S]*?<Stack\b[\s\S]*?<\/PortalHost>/);
  });
});
