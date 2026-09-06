import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `session-nav-actions.tsx` source-level contract test — same reason as
 * `./compact-shell.test.ts`/`../app/h/[serverId]/session/[agentId]/
 * index.test.ts`: this module imports `react-native`/`expo-router`, so
 * it cannot run directly under this workspace's plain `vitest` setup
 * (see this repository's `CLAUDE.md`). The real behavioural proof — that
 * pressing either control navigates to the exact route
 * `navigationIntentToPath` would produce — lives in
 * `./session-nav-actions-model.test.ts`, run directly against the
 * RN-free `pressSessionFiles`/`pressSessionTerminal` this file only
 * threads through. `readCode()` strips comments first, so an assertion
 * anchored only to a doc-comment mention (this file's own catalogued
 * defect class) cannot pass.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./session-nav-actions.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("SessionNavActions source", () => {
  it("imports pressSessionFiles/pressSessionTerminal from the RN-free model, never re-deriving the navigation decision here", () => {
    const code = readCode();
    expect(code).toMatch(
      /import \{ pressSessionFiles, pressSessionTerminal \} from "\.\/session-nav-actions-model";/,
    );
    // Never a hand-built path string or a direct destinationHref/
    // navigationIntentToPath call in this file — the model owns that.
    expect(code).not.toMatch(/destinationHref\(/);
    expect(code).not.toMatch(/navigationIntentToPath\(/);
  });

  it("wires a real router from useRouter() into both press handlers, with this route's own serverId/agentId — never a fixed literal", () => {
    const code = readCode();
    expect(code).toMatch(/const router = useRouter\(\);/);
    expect(code).toMatch(/onPress=\{\(\) => pressSessionFiles\(router, serverId, agentId\)\}/);
    expect(code).toMatch(/onPress=\{\(\) => pressSessionTerminal\(router, serverId, agentId\)\}/);
  });

  it("renders two Button primitives with a visible, TalkBack-announced label — Files and Terminal — each with a stable testId", () => {
    const code = readCode();
    expect(code).toMatch(/from "\.\.\/ui\/primitives";/);
    expect(code).toMatch(/<Button\b[\s\S]*?label="Files"[\s\S]*?testId=\{`\$\{testId\}-files`\}/);
    expect(code).toMatch(
      /<Button\b[\s\S]*?label="Terminal"[\s\S]*?testId=\{`\$\{testId\}-terminal`\}/,
    );
  });

  it("takes serverId/agentId as required props (not optional, not defaulted to empty strings here)", () => {
    const code = readCode();
    expect(code).toMatch(
      /export interface SessionNavActionsProps \{\s*serverId: string;\s*agentId: string;\s*testId\?: string;\s*\}/,
    );
  });
});
