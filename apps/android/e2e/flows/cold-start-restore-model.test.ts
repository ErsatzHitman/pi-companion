/**
 * T37E2 — proves the cold-start session restore path's *decision logic*
 * against real values, and proves `cold-start-restore.yaml`'s testId
 * anchors actually exist in source. See that flow file's own "KNOWN
 * BLOCKER" comment: there is no emulator, device, or Maestro binary in
 * this wave, so this file — not a device run — is this task's real
 * proof, per plan.md §14's model-level-property standard for a task with
 * no device.
 *
 * Three things this file does NOT do, on purpose:
 *  - It never imports `app/index.tsx`, `app/core-context.tsx`, or any
 *    `.tsx` file. Both reach `react-native` transitively (via
 *    `app-shell/core.ts`'s real platform adapters and `expo-router`
 *    respectively) and fail under this workspace's plain `vitest` per
 *    this repository's documented RolldownError limitation. Their exact
 *    source text is asserted instead (`readCode()` below, comment-
 *    stripped, full-expression matches only — never a bare identifier).
 *  - It never duplicates `sessions-model.ts`'s already-proven "a missing
 *    session fails with a clear message and clears the stored id"
 *    behavior — that is T32B3's own
 *    `sessions-model.test.ts` ("openAndLoadSession: a missing session
 *    fails with a clear, distinct message and clears the stored id"),
 *    a file this task does not own and has no need to re-prove.
 *  - It never talks to a socket, an emulator, or `adb`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { navigation } from "@picompanion/frontend-core";

import { destinationHref } from "../../src/app-shell/top-level-destinations.js";

function readSource(relativeToThisFile: string): string {
  return readFileSync(fileURLToPath(new URL(relativeToThisFile, import.meta.url)), "utf8");
}

/**
 * Strips comments before matching, exactly like
 * `apps/android/src/app/h/[serverId]/session/[agentId]/index.test.ts`'s
 * `readCode()` — see that file's doc comment for why an unstripped match
 * can pass against a file's own explanatory prose rather than its real
 * code. Every assertion below matches a full statement/expression, never
 * a bare identifier a mere import line would also satisfy.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const indexRouteCode = () => stripComments(readSource("../../src/app/index.tsx"));
const coreContextCode = () => stripComments(readSource("../../src/app/core-context.tsx"));
const onboardingGateCode = () =>
  stripComments(readSource("../../src/features/connect/OnboardingGate.tsx"));
const connectRouteCode = () => stripComments(readSource("../../src/app/connect.tsx"));
const connectionShellCode = () =>
  stripComments(readSource("../../src/features/connect/connection-shell.tsx"));
const connectFormCode = () =>
  stripComments(readSource("../../src/features/connect/ConnectForm.tsx"));
const sessionsScreenCode = () =>
  stripComments(readSource("../../src/features/sessions/sessions-screen.tsx"));

// -----------------------------------------------------------------------
// Branch 1: a stored cold-start profile resolves to the session-list
// href; no profile resolves to "/connect" (app/index.tsx).
// -----------------------------------------------------------------------

describe("cold-start redirect target (app/index.tsx's IndexRoute)", () => {
  it("real value: a stored profile's session-list href is /h/<id>/sessions", () => {
    const href = destinationHref({
      type: "sessionList",
      serverId: "srv-cold-start-1",
    } satisfies navigation.NavigationDestinationIntent);
    expect(href).toBe("/h/srv-cold-start-1/sessions");
  });

  it("real value: an id with characters requiring encoding still round-trips through destinationHref", () => {
    const href = destinationHref({ type: "sessionList", serverId: "srv with space" });
    expect(href).toBe("/h/srv%20with%20space/sessions");
  });

  it('source: IndexRoute\'s redirect target is exactly `hasInitialShare ? "/share" : profile ? destinationHref({ type: "sessionList", serverId: profile.id }) : "/connect"`', () => {
    expect(indexRouteCode()).toMatch(
      /const href = hasInitialShare\s*\?\s*"\/share"\s*:\s*profile\s*\?\s*destinationHref\(\{\s*type:\s*"sessionList",\s*serverId:\s*profile\.id\s*\}\)\s*:\s*"\/connect";/,
    );
    expect(indexRouteCode()).toMatch(/return <Redirect href=\{href\} \/>;/);
  });

  it("source: the fallback truly is the connect path — this string must survive a mutation-checked read", () => {
    // Full-expression match, not a bare `"/connect"` search: the ternary
    // form above already anchors this to the actual branch, not a
    // comment mentioning "/connect" elsewhere in the file (this file's
    // own doc comment mentions "/connect" nine times).
    expect(indexRouteCode()).toMatch(/:\s*"\/connect";/);
  });
});

// -----------------------------------------------------------------------
// Branch 2: AppCoreProvider's cold-start gate — a stored profile
// resolves to it, an empty list resolves to null, and a storage read
// that *throws* resolves to null (never hangs, never crashes) —
// app/core-context.tsx.
//
// `AppCoreProvider` cannot be rendered here (it transitively reaches
// react-native through `createAppCore()`'s real platform adapters), so
// its `.then().catch()` resolution is mirrored here as a small pure
// function proved against real fake `listHostProfiles`-shaped
// functions, then pinned to the real source text below so the two
// cannot silently drift apart.
// -----------------------------------------------------------------------

interface FakeProfile {
  id: string;
}

interface ColdStartResult {
  profile: FakeProfile | null;
  hasInitialShare: boolean;
}

/**
 * Mirrors `AppCoreProvider`'s effect body exactly (T32S15 extended this to
 * also peek `getInitialShareIntent()` alongside the profile read — see
 * that effect's own doc comment for why a share-read failure alone must
 * never fall the whole gate through to the "no profile" branch):
 * `Promise.all([listHostProfiles(...), getInitialShareIntent().catch(() =>
 * null)]).then(([profiles, initialShare]) => set({ resolved: true, profile:
 * profiles[0] ?? null, hasInitialShare: initialShare !== null
 * })).catch(() => set({ resolved: true, profile: null, hasInitialShare:
 * false }))` — see the source-text assertions below, which pin this
 * mirror to the real file so it cannot drift without failing.
 */
async function resolveColdStart(
  listHostProfiles: () => Promise<FakeProfile[]>,
  getInitialShareIntent: () => Promise<unknown>,
): Promise<ColdStartResult> {
  return Promise.all([listHostProfiles(), getInitialShareIntent().catch(() => null)])
    .then(([profiles, initialShare]) => ({
      profile: profiles[0] ?? null,
      hasInitialShare: initialShare !== null,
    }))
    .catch(() => ({ profile: null, hasInitialShare: false }));
}

describe("cold-start profile resolution (app/core-context.tsx's AppCoreProvider gate)", () => {
  const noShare = () => Promise.resolve(null);

  it("real value: a stored profile resolves to that profile, with no pending share", async () => {
    const result = await resolveColdStart(async () => [{ id: "srv-1" }, { id: "srv-2" }], noShare);
    expect(result).toEqual({ profile: { id: "srv-1" }, hasInitialShare: false });
  });

  it("real value: no stored profile (empty list) resolves to a null profile", async () => {
    const result = await resolveColdStart(async () => [], noShare);
    expect(result.profile).toBeNull();
  });

  it("real value: a storage read that throws resolves to null/false rather than rejecting or hanging", async () => {
    const rejecting = () => Promise.reject(new Error("SecureStorage.isAvailable() is false"));
    await expect(resolveColdStart(rejecting, noShare)).resolves.toEqual({
      profile: null,
      hasInitialShare: false,
    });
  });

  it("real value: a real pending share intent resolves hasInitialShare true, alongside whatever the profile read found", async () => {
    const result = await resolveColdStart(
      async () => [],
      async () => ({ action: "SEND", mimeType: "text/plain", text: "hi" }),
    );
    expect(result).toEqual({ profile: null, hasInitialShare: true });
  });

  it("real value: a share-read failure alone still lets a successful profile read resolve — never falls through to null", async () => {
    const result = await resolveColdStart(
      async () => [{ id: "srv-1" }],
      () => Promise.reject(new Error("native module not linked")),
    );
    expect(result).toEqual({ profile: { id: "srv-1" }, hasInitialShare: false });
  });

  it("source: the real effect body sets { resolved: true, profile: profiles[0] ?? null, hasInitialShare: initialShare !== null } on success", () => {
    expect(coreContextCode()).toMatch(
      /\.then\(\(\[profiles, initialShare\]\) => \{\s*if \(!cancelled\) \{\s*setColdStart\(\{\s*resolved:\s*true,\s*profile:\s*profiles\[0\]\s*\?\?\s*null,\s*hasInitialShare:\s*initialShare !== null,\s*\}\);/,
    );
  });

  it("source: the real effect body sets { resolved: true, profile: null, hasInitialShare: false } on rejection — the failure fallback this mirror reproduces", () => {
    expect(coreContextCode()).toMatch(
      /\.catch\(\(\)\s*=>\s*\{\s*if \(!cancelled\) setColdStart\(\{\s*resolved:\s*true,\s*profile:\s*null,\s*hasInitialShare:\s*false\s*\}\);\s*\}\)/,
    );
  });

  it("source: the read this mirrors is the real listHostProfiles call, given core's own secureStorage/keyValueStorage", () => {
    expect(coreContextCode()).toMatch(
      /listHostProfiles\(\{\s*secureStorage:\s*core\.secureStorage,\s*plainStorage:\s*core\.keyValueStorage\s*\}\)/,
    );
  });

  it("source: the share read this mirrors is the real AppCore.shareIntentPort.getInitialShareIntent() call, its own failure swallowed before Promise.all sees it", () => {
    expect(coreContextCode()).toMatch(
      /core\.shareIntentPort\.getInitialShareIntent\(\)\.catch\(\(\) => null\)/,
    );
  });

  it("source: children (and so every route) are withheld — return null — until the gate resolves", () => {
    expect(coreContextCode()).toMatch(/if \(!coldStart\.resolved\) \{\s*return null;\s*\}/);
  });
});

// -----------------------------------------------------------------------
// testId anchors: cold-start-restore.yaml names these exact ids/text.
// This suite fails the moment any of them stops existing in source, per
// this repository's "a value nothing imports/asserts is not done" and
// source-text-test rules — every match below is a full JSX prop
// assignment or literal, never a bare identifier.
// -----------------------------------------------------------------------

describe("cold-start-restore.yaml's testId anchors exist in source", () => {
  it('app/connect.tsx names the onboarding gate "connect-onboarding"', () => {
    expect(connectRouteCode()).toMatch(
      /<OnboardingGate storage=\{core\.keyValueStorage\} testId="connect-onboarding">/,
    );
  });

  it('OnboardingGate\'s welcome step continue button is "${testId}-welcome-continue"', () => {
    expect(onboardingGateCode()).toMatch(
      /testId=\{testId \? `\$\{testId\}-welcome-continue` : undefined\}/,
    );
  });

  it('OnboardingGate\'s permissions step Continue button is "${testId}-permission-continue" and always calls complete()', () => {
    expect(onboardingGateCode()).toMatch(
      /label="Continue"\s*onPress=\{\(\) => void controller\.complete\(\)\}\s*testId=\{testId \? `\$\{testId\}-permission-continue` : undefined\}/,
    );
  });

  it('connection-shell.tsx names its form "connect-form" and renders the literal "Pi Companion" heading', () => {
    // T32S14 (P5-W20, this same wave) added the `profiles` prop.
    expect(connectionShellCode()).toMatch(
      /<ConnectForm testId="connect-form" onSubmit=\{handleSubmit\} profiles=\{profileOptions\} \/>/,
    );
    expect(connectionShellCode()).toMatch(/<Text style=\{styles\.title\}>Pi Companion<\/Text>/);
  });

  it('connection-shell.tsx\'s connected status text starts with the literal "Connected"', () => {
    expect(connectionShellCode()).toMatch(/return `Connected\$\{pathSuffix\}`;/);
  });

  it('ConnectForm\'s name/address/submit fields are "${testId}-name-field"/"-address-field"/"-submit-button"', () => {
    expect(connectFormCode()).toMatch(/testId=\{testId \? `\$\{testId\}-name-field` : undefined\}/);
    expect(connectFormCode()).toMatch(
      /testId=\{testId \? `\$\{testId\}-address-field` : undefined\}/,
    );
    expect(connectFormCode()).toMatch(
      /testId=\{testId \? `\$\{testId\}-submit-button` : undefined\}/,
    );
  });

  it('sessions-screen.tsx\'s root testId is "sessions-screen-${serverId}"', () => {
    expect(sessionsScreenCode()).toMatch(/const testId = `sessions-screen-\$\{serverId\}`;/);
    // T329 widened the ScrollView to a multi-line JSX tag (it gained
    // `keyboardShouldPersistTaps`), so the anchor tolerates any props
    // between `<ScrollView` and its closing `>`.
    expect(sessionsScreenCode()).toMatch(
      /<ScrollView\s[^>]*style=\{\[?styles\.container[^>]*testID=\{testId\}[^>]*>/,
    );
  });

  it('sessions-screen.tsx\'s create-session fields are "${testId}-create-cwd"/"-create-submit", reached via "${testId}-create"', () => {
    expect(sessionsScreenCode()).toMatch(/testId=\{`\$\{testId\}-create`\}/);
    expect(sessionsScreenCode()).toMatch(/testId=\{`\$\{testId\}-cwd`\}/);
    expect(sessionsScreenCode()).toMatch(/testId=\{`\$\{testId\}-submit`\}/);
  });

  it('sessions-screen.tsx\'s session rows are "${testId}-row-${row.id}", and opening one persists it as the last-opened session', () => {
    expect(sessionsScreenCode()).toMatch(/testId=\{`\$\{testId\}-row-\$\{row\.id\}`\}/);
    expect(sessionsScreenCode()).toMatch(
      /if \(keyValueStorage\) void writeLastOpenedSessionId\(keyValueStorage, sessionId\);/,
    );
  });

  it('sessions-screen.tsx\'s open-error banner is "${testId}-open-error" and its restore-stale banner is "${testId}-open-stale"', () => {
    expect(sessionsScreenCode()).toMatch(
      /<Banner tone="danger" message=\{openState\.message\} testId=\{`\$\{testId\}-open-error`\} \/>/,
    );
    expect(sessionsScreenCode()).toMatch(/testId=\{`\$\{testId\}-open-stale`\}/);
  });
});

// -----------------------------------------------------------------------
// P5-W18 merge gate: both production-wiring gaps cold-start-restore.yaml's
// "KNOWN BLOCKER" comment named are now CLOSED by T32A8 — `handleSubmit`
// awaits the connect attempt, saves through the real `saveHostProfile`,
// and navigates with `router.replace(outcome.href)`. The note that used
// to stand here explained why this suite pinned only `store.connect` and
// deliberately wrote no `.not.toMatch(/saveHostProfile\(/)` negative
// assertion; that reasoning held (a negative pin would have had to be
// deleted here anyway), but its premise — "the one call site that *does*
// exist today" — is false as of T32A8, so the assertion below now covers
// the whole save-then-navigate path the yaml's connect step exercises.
// -----------------------------------------------------------------------

describe("the connect call site cold-start-restore.yaml's connect step actually exercises", () => {
  // One contiguous match anchored at `handleSubmit`'s own signature, not
  // four independent whole-file matches. `handlePaired` in the same file
  // carries a byte-identical `await saveHostProfile(...)` +
  // `router.replace(outcome.href)` pair, so separate whole-file
  // assertions would survive deleting handleSubmit's copy entirely —
  // defect (5) from CLAUDE.md's source-text-regex note (a sibling
  // occurrence satisfying the match). Verified by mutation at the P5-W18
  // gate: removing only handleSubmit's save-then-navigate block, leaving
  // handlePaired's intact, fails this test.
  it("connection-shell.tsx's handleSubmit connects through the app-wide DaemonConnectionStore, then saves and navigates", () => {
    expect(connectionShellCode()).toMatch(
      /async function handleSubmit\([\s\S]{0,200}?const attempt = await store\.connect\(result\.draft\.parsed\);\s*const outcome = deriveConnectSubmitOutcome\(result\.draft, undefined, attempt\);\s*if \(outcome\.kind !== "connected"\) return;\s*await saveHostProfile\(\s*\{ plainStorage: keyValueStorage, secureStorage \},\s*outcome\.profile,\s*outcome\.secrets,\s*\);\s*router\.replace\(outcome\.href\);/,
    );
  });
});
