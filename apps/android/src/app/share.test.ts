import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `/share` route source-level contract (T69). Source-text only, same
 * reason as `./connect.test.ts`: this module imports `react-native`
 * (transitively, via `ShareChooserScreen.tsx`). The real behaviour this
 * route drives from — `ShareChooserRuntime`'s state transitions, a
 * resolved choice materializing a draft — is proven with real behavior,
 * no React or `expo-router` involved, in `../features/share/
 * share-chooser-runtime.test.ts`.
 *
 * `readCode()` strips comments before matching, same discipline as
 * `./connect.test.ts`'s own `readCode()` — this file's own doc comment
 * names every seam by name, so an unanchored match against raw source
 * would stay green even if the real wiring were deleted.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./share.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("ShareRoute source", () => {
  it("builds its runtime from the real AppCore.shareIntentPort, never a second port constructed here", () => {
    const code = readCode();
    expect(code).toMatch(
      /import \{ useAppCore, useColdStartProfile \} from "\.\/core-context\.js";/,
    );
    expect(code).toMatch(/const core = useAppCore\(\);/);
    expect(code).toMatch(/port: core\.shareIntentPort/);
  });

  it("fetches real destinations via sessionService.refreshSessions() and filters out archived sessions", () => {
    const code = readCode();
    expect(code).toMatch(/core\.sessionService\.refreshSessions\(\)/);
    expect(code).toMatch(/\.filter\(\(session\) => !session\.archivedAt\)/);
    expect(code).toMatch(/session\.title \?\? "Untitled session"/);
  });

  it("pushes fresh candidate ids before starting the runtime, so a launch share sees real destinations", () => {
    const code = readCode();
    const setIdsIndex = code.indexOf("runtime.setCandidateSessionIds(");
    const startIndex = code.indexOf("await runtime.start();");
    expect(setIdsIndex).toBeGreaterThan(0);
    expect(startIndex).toBeGreaterThan(setIdsIndex);
  });

  it("starts on mount and stops on unmount", () => {
    const code = readCode();
    expect(code).toMatch(/useEffect\(\(\) => \{/);
    expect(code).toMatch(/return \(\) => \{\s*cancelled = true;\s*runtime\.stop\(\);\s*\};/);
  });

  it("navigates to the resolved session via destinationHref, never a URL/query string built from shared content", () => {
    const code = readCode();
    expect(code).toMatch(/snapshot\.state\.status === "resolved" && profile/);
    expect(code).toMatch(
      /destinationHref\(\s*\{\s*type: "session",\s*serverId: profile\.id,\s*agentId: snapshot\.state\.sessionId,?\s*\}\s*\)/,
    );
    expect(code).not.toMatch(/[?&]\w+=\$\{/);
    expect(code).not.toMatch(/console\./);
  });

  it("renders ShareChooserScreen with the live runtime snapshot and real destinations, wiring onChoose to resolveChoice and onDismiss to dismiss", () => {
    const code = readCode();
    expect(code).toMatch(
      /import \{\s*ShareChooserScreen,\s*type ShareChooserDestination,\s*\} from "\.\.\/features\/share\/ShareChooserScreen\.js";/,
    );
    expect(code).toMatch(/state=\{snapshot\.state\}/);
    expect(code).toMatch(/destinations=\{destinations\}/);
    expect(code).toMatch(/onChoose=\{\(sessionId\) => void runtime\.resolveChoice\(sessionId\)\}/);
    expect(code).toMatch(/onDismiss=\{\(\) => runtime\.dismiss\(\)\}/);
  });

  it("uses the RN-free useShareChooserSnapshot hook, not a bespoke subscription", () => {
    const code = readCode();
    expect(code).toMatch(
      /import \{ useShareChooserSnapshot \} from "\.\.\/features\/share\/use-share-chooser\.js";/,
    );
    expect(code).toMatch(/const snapshot = useShareChooserSnapshot\(runtime\);/);
  });
});
