import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `/connect` route stub coverage — T32S1C, extended by T32S10's
 * `OnboardingGate` mount. Source-level contract test, same reason as
 * `./navigation-shell.test.ts`: this module imports `react-native` (via
 * `ConnectionShell`).
 *
 * `readCode()` strips comments before matching — this file's own doc
 * comment names `OnboardingGate`/`keyValueStorage`/`ConnectionShell`, so
 * an unanchored match against the raw source (including comments) would
 * stay green even if the real import/JSX were deleted. Same discipline
 * as `./h/[serverId]/session/[agentId]/index.test.ts`'s `readCode()`.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./connect.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("ConnectRoute source", () => {
  it("imports its screen from features/connect rather than containing feature logic itself", () => {
    expect(readCode()).toMatch(/from "\.\.\/features\/connect"/);
    expect(readCode()).toMatch(/<ConnectionShell\s*\/>/);
  });

  // --- T32S10: OnboardingGate (T32A6) had no live importer -------------

  it("wraps ConnectionShell in OnboardingGate, imported from the same features/connect barrel", () => {
    const code = readCode();
    expect(code).toMatch(
      /import \{ ConnectionShell, OnboardingGate \} from "\.\.\/features\/connect";/,
    );
    expect(code).toMatch(
      /<OnboardingGate\s+storage=\{core\.keyValueStorage\}[\s\S]*?>\s*<ConnectionShell\s*\/>\s*<\/OnboardingGate>/,
    );
  });

  it("reads storage from the real AppCore.keyValueStorage via useAppCore, never a second store constructed here", () => {
    const code = readCode();
    expect(code).toMatch(/import \{ useAppCore \} from "\.\/core-context";/);
    expect(code).toMatch(/const core = useAppCore\(\);/);
    expect(code).toMatch(/storage=\{core\.keyValueStorage\}/);
    expect(code).not.toMatch(/storage=\{undefined\}/);
  });

  it("passes no custom permissions port, taking OnboardingGate's own real createOnboardingPermissionsPort() default", () => {
    // A route-constructed permissions port would be a second one racing
    // OnboardingGate's own default (camera via qr-scanner-port.ts,
    // settings via RN Linking) - this route supplies none.
    expect(readCode()).not.toMatch(/permissions=\{/);
  });
});
