import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `/h/:serverId/session/:agentId/terminal/:terminalId` route stub
 * coverage — T32S1C, given a real terminal transport by T32S12
 * (P5-W18). Source-level contract test, same reason as `../index.test.ts`:
 * this module imports `expo-router`.
 *
 * `readCode()` strips comments before matching — this file's own doc
 * comment names `createTerminalTransport`/`transport`, so an unanchored
 * match against the raw source would stay green even if the real prop
 * wiring were deleted. See `../../../../(tabs)/sessions.test.ts`'s doc
 * comment for the concrete precedent this guards against.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./[terminalId].tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("SessionTerminalRoute source", () => {
  it("imports its screen from features/terminal rather than containing feature logic itself", () => {
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/terminal"/);
    expect(readCode()).toMatch(/<TerminalScreen\b/);
  });

  it("reads serverId/agentId/terminalId from the route params", () => {
    expect(readCode()).toMatch(/useLocalSearchParams/);
    expect(readCode()).toMatch(/terminalId/);
  });

  // T32S12 (P5-W18): this route used to pass no `transport` prop at all,
  // so `TerminalScreen` always fell back to its own permanently-closed
  // `createNotConnectedTerminalBinaryTransport()` regardless of
  // connection health.
  it("builds a real transport from useAppCore().createTerminalTransport and passes it to TerminalScreen, memoized on [core, terminalId]", () => {
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/core-context"/);
    expect(readCode()).toMatch(/const core = useAppCore\(\);/);
    expect(readCode()).toMatch(
      /useMemo\(\s*\(\)\s*=>\s*core\.createTerminalTransport\(terminalId \?\? "", 0\),\s*\[core, terminalId\],?\s*\)/,
    );
    expect(readCode()).toMatch(/<TerminalScreen[\s\S]{0,200}transport=\{transport\}/);
  });

  // T80 (P5-W23): this route used to pass no `webview` prop at all, so
  // `TerminalScreen` always fell back to its own
  // `createUnavailableTerminalWebViewPort()` regardless of what `AppCore`
  // held — even a build with `react-native-webview` installed would have
  // rendered the unavailable state, because nothing wired a real
  // implementation through. `readCode()` strips comments (see this file's
  // own doc comment), so this only passes if the prop actually appears in
  // the JSX, not merely in prose describing it.
  it("passes core.terminalWebview as TerminalScreen's webview prop", () => {
    expect(readCode()).toMatch(/<TerminalScreen[\s\S]{0,300}webview=\{core\.terminalWebview\}/);
  });
});
