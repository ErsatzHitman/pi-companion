import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T351 source-level contract for `use-agent-cwd.ts`.
 *
 * The module itself imports nothing but `react`, so it parses fine here
 * — but a hook cannot be CALLED outside a renderer, and this workspace
 * has none (see `../extensions/renderers/log-model.ts`'s doc comment for
 * why: any test whose import graph reaches `react-native` dies on a
 * RolldownError, which rules out `@testing-library/react-native`). The
 * behaviour worth proving by execution is the string work, and that
 * lives in `./header-model.ts`'s `deriveCwdBasename`, which
 * `header-model.test.ts` exercises against real paths from both kinds
 * of host. What is left here are the four properties a render pass
 * would otherwise check, pinned against the real source text.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./use-agent-cwd.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("T351 useAgentCwd: the app bar's working-directory read", () => {
  it("reads the cwd from the daemon's own agent snapshot, not from a route param or a guess", () => {
    const source = readCode();
    expect(source).toMatch(/client\s*\.fetchAgent\(agentId\)/);
    expect(source).toMatch(/setCwd\(result\?\.agent\.cwd\)/);
  });

  it("issues no request at all with no client or no agent, so a disconnected bar simply has no subtitle", () => {
    expect(readCode()).toMatch(/if\s*\(!client\?\.fetchAgent\s*\|\|\s*agentId\.length === 0\)/);
  });

  it("cancels on unmount, so a late response never sets state on a gone component", () => {
    const source = readCode();
    expect(source).toMatch(/let cancelled = false/);
    expect(source).toMatch(/if \(cancelled\) return/);
    expect(source).toMatch(/return \(\) => \{\s*cancelled = true;\s*\};/);
  });

  it("swallows a rejected snapshot request into an absent subtitle rather than an unhandled rejection", () => {
    const source = readCode();
    expect(source).toMatch(/\.catch\(/);
    expect(source).toMatch(/setCwd\(undefined\)/);
  });

  it("re-runs when either the client or the agent changes, so a reconnect refreshes the subtitle", () => {
    expect(readCode()).toMatch(/\}, \[client, agentId\]\);/);
  });

  it("imports nothing from react-native, so the bar's data read stays renderer-free", () => {
    expect(readCode()).not.toMatch(/react-native/);
  });
});
