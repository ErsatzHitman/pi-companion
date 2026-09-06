import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `ShareChooserScreen.tsx` source-level contract (T69). Source-text
 * only, same reason as `../connect/connection-shell.test.ts`: this
 * module imports `react-native` (via `../../ui/primitives`), which
 * fails to import under this workspace's plain `vitest` setup
 * (`../../CLAUDE.md`'s VITEST LIMITATION note). The actual
 * presentation *logic* this component drives from —
 * `ShareChooserState`'s named statuses — is proven with real behavior,
 * no React involved, in `share-chooser-runtime.test.ts` and
 * `share-session-chooser.test.ts`.
 *
 * `readCode()` strips comments before matching (this file's own doc
 * comment names every status by name, so an unanchored match against
 * raw source would stay green even if a branch were deleted).
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./ShareChooserScreen.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("ShareChooserScreen source", () => {
  it("branches on every ShareChooserState status by name", () => {
    const code = readCode();
    for (const status of ["idle", "no-sessions", "cancelled", "invalid-session", "resolved"]) {
      expect(code).toMatch(new RegExp(`state\\.status === "${status}"`));
    }
    // The sixth status, "choosing", has no explicit `=== "choosing"`
    // check — it is the function's final, un-guarded branch (every
    // other status returns first) — proven instead by the destination
    // list existing at all, asserted below.
  });

  it("renders a distinct, visible no-sessions state rather than reusing the idle branch", () => {
    const code = readCode();
    const idleIndex = code.indexOf('state.status === "idle"');
    const noSessionsIndex = code.indexOf('state.status === "no-sessions"');
    expect(idleIndex).toBeGreaterThanOrEqual(0);
    expect(noSessionsIndex).toBeGreaterThan(idleIndex);
    // Each branch returns its own <ScrollView ... testID={`${testId}-<status>`}>
    expect(code).toMatch(/testID=\{`\$\{testId\}-idle`\}/);
    expect(code).toMatch(/testID=\{`\$\{testId\}-no-sessions`\}/);
    expect(code).toMatch(/title="No sessions to share to yet"/);
  });

  it("lists every candidate session id as a tappable destination that calls onChoose with that id", () => {
    const code = readCode();
    expect(code).toMatch(/state\.candidateSessionIds\.map\(\(sessionId\) => \(/);
    expect(code).toMatch(/onPress=\{\(\) => onChoose\(sessionId\)\}/);
    expect(code).toMatch(/label=\{titleById\.get\(sessionId\) \?\? sessionId\}/);
  });

  it("dismiss/cancel controls call onDismiss, never onChoose or a direct navigation", () => {
    const code = readCode();
    expect(code).toMatch(/label="Dismiss"\s+onPress=\{onDismiss\}/);
    expect(code).toMatch(/label="Cancel"\s+onPress=\{onDismiss\}/);
    expect(code).not.toMatch(/expo-router/);
    expect(code).not.toMatch(/useRouter/);
  });

  it("warns, but never blocks, on secret-shaped shared text", () => {
    const code = readCode();
    expect(code).toMatch(/state\.content\.kind === "text" && state\.content\.looksSecretShaped/);
    expect(code).toMatch(/tone="warning"/);
    // "annotated, never blocked" — no early return/guard keeps the
    // destination list from rendering when this fires.
    const warningIndex = code.indexOf("looksSecretShaped");
    const listIndex = code.indexOf("candidateSessionIds.map");
    expect(listIndex).toBeGreaterThan(warningIndex);
  });

  it("never logs shared content and never builds a URL/query string from it", () => {
    const code = readCode();
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/[?&]\w+=\$\{/); // no interpolated query-string construction
    expect(code).not.toMatch(/href=/);
  });

  it("imports Banner/Button/EmptyState/Section from the shared primitives, not a bespoke row component", () => {
    const code = readCode();
    expect(code).toMatch(/from "\.\.\/\.\.\/ui\/primitives\/Banner"/);
    expect(code).toMatch(/from "\.\.\/\.\.\/ui\/primitives\/Button"/);
    expect(code).toMatch(/from "\.\.\/\.\.\/ui\/primitives\/PlaceholderState"/);
    expect(code).toMatch(/from "\.\.\/\.\.\/ui\/primitives\/Section"/);
  });
});
