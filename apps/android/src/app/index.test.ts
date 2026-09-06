import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `/` route stub coverage — T32S1C, cold-start rationale extended by
 * T32S2, and made stored-connection-aware by T32S3 (item 3): a stored
 * host profile now redirects straight to that host's session list
 * instead of unconditionally to `/connect`. Source-level contract test,
 * same reason as `../app-shell/navigation-shell.test.ts`: this module
 * imports `expo-router`.
 *
 * `readCode()` strips comments before matching, same reason as
 * `h/[serverId]/session/[agentId]/index.test.ts`'s: this file's own doc
 * comment names `useColdStartProfile`/`destinationHref`/`"/connect"`.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./index.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("IndexRoute source", () => {
  it("reads the resolved cold-start profile from useColdStartProfile()", () => {
    expect(readCode()).toMatch(/const profile = useColdStartProfile\(\);/);
  });

  it('redirects to "/connect" when there is no stored profile', () => {
    expect(readCode()).toMatch(/: "\/connect"/);
  });

  it("redirects to that profile's session list (destinationHref, type sessionList) when one exists", () => {
    expect(readCode()).toMatch(
      /destinationHref\(\{\s*type:\s*"sessionList",\s*serverId:\s*profile\.id\s*\}\)/,
    );
  });

  it("renders <Redirect> with the computed href, not a fixed literal", () => {
    expect(readCode()).toMatch(/<Redirect href=\{href\}\s*\/>/);
    expect(readCode()).not.toMatch(/<Redirect\s+href="\/connect"\s*\/>/);
  });

  /**
   * T32S15: a cold start launched by a real OS share intent now redirects
   * to `/share` first — checked ahead of the profile branch, since a
   * share still needs somewhere to land from a device with no saved
   * profile yet.
   */
  it("reads the resolved cold-start share flag from useColdStartHasShareIntent() and redirects to /share first", () => {
    expect(readCode()).toMatch(/const hasInitialShare = useColdStartHasShareIntent\(\);/);
    expect(readCode()).toMatch(
      /const href = hasInitialShare\s*\?\s*"\/share"\s*:\s*profile\s*\?\s*destinationHref\(\{\s*type:\s*"sessionList",\s*serverId:\s*profile\.id\s*\}\)\s*:\s*"\/connect";/,
    );
  });
});
