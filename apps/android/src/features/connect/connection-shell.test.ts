import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `connection-shell.tsx` source-level contract — T32A8 ("Complete the
 * connect-to-session-list path"). Source-text only, same reason as
 * `../../app/h/[serverId]/session/[agentId]/index.test.ts`: this module
 * imports `react-native`, which fails to import under this workspace's
 * plain `vitest` setup (`../../CLAUDE.md`'s "VITEST LIMITATION" note).
 *
 * The *values* this file's wiring produces (the exact saved
 * `HostProfileRecord`/`HostProfileSecrets`, the exact href, and the
 * `"connected"` vs `"failed"` outcome split) are proven directly,
 * against no React import at all, in `connection-shell-model.test.ts`.
 * This file proves only that `connection-shell.tsx` actually calls that
 * tested logic and actually calls the real `saveHostProfile` /
 * `router.replace` with its result — not merely that those names are
 * imported (this wave's five catalogued source-text-regex defect
 * classes; see `readCode()`/`readFunctionCode()` below for how this
 * file avoids them).
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./connection-shell.tsx", import.meta.url)), "utf8");
}

/** Strips block and line comments before matching, so a doc comment that merely *names* a symbol can never satisfy an assertion about real code (defect classes (2)/(4) in `../../CLAUDE.md`'s source-text-regex warning). */
function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * `readCode()` sliced down to one named function's brace-balanced body
 * — `connection-shell.tsx` declares two similarly-shaped async
 * functions (`handleSubmit`, `handlePaired`), so a whole-file
 * `toMatch()` could stay green with only one of the two actually wired
 * (this wave's "sibling occurrence" defect class (5)). Every assertion
 * about either function's body runs against this slice, never the raw
 * whole-file source.
 */
function readFunctionCode(name: string): string {
  const code = readCode();
  const marker = `function ${name}(`;
  const start = code.indexOf(marker);
  expect(
    start,
    `connection-shell.tsx should declare a function named ${name}`,
  ).toBeGreaterThanOrEqual(0);

  // Balance the parameter list's own parens first — `handleSubmit`'s
  // parameter type (`Extract<ConnectFormValidation, { ok: true }>`)
  // contains a brace of its own, so naively scanning for the first `{`
  // from `start` would stop inside the parameter list, not at the
  // function body.
  let parenDepth = 0;
  let afterParams = start + marker.length - 1; // index of the opening "("
  for (; afterParams < code.length; afterParams++) {
    if (code[afterParams] === "(") parenDepth++;
    else if (code[afterParams] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        afterParams++;
        break;
      }
    }
  }

  const braceStart = code.indexOf("{", afterParams);
  let braceDepth = 0;
  let end = braceStart;
  for (; end < code.length; end++) {
    if (code[end] === "{") braceDepth++;
    else if (code[end] === "}") {
      braceDepth--;
      if (braceDepth === 0) {
        end++;
        break;
      }
    }
  }
  return code.slice(start, end);
}

describe("ConnectionShell source", () => {
  it("navigates through expo-router's useRouter().replace, never router.push", () => {
    expect(readCode()).toMatch(/import \{ useRouter \} from "expo-router";/);
    expect(readCode()).toMatch(/const router = useRouter\(\);/);
    expect(readCode()).not.toMatch(/router\.push\(/);
  });

  it("imports the real saveHostProfile/listHostProfiles/loadHostProfileSecrets and connection-shell-model's outcome derivers, including T32S14's deriveReconnectOutcome", () => {
    const code = readCode();
    expect(code).toMatch(
      /import \{[\s\S]{0,200}listHostProfiles,[\s\S]{0,200}\} from "\.\/credential-store";/,
    );
    expect(code).toMatch(
      /import \{[\s\S]{0,200}loadHostProfileSecrets,[\s\S]{0,200}\} from "\.\/credential-store";/,
    );
    expect(code).toMatch(
      /import \{[\s\S]{0,200}saveHostProfile,[\s\S]{0,200}\} from "\.\/credential-store";/,
    );
    expect(code).toMatch(
      /import \{[\s\S]{0,200}deriveConnectSubmitOutcome,[\s\S]{0,200}deriveReconnectOutcome,[\s\S]{0,200}derivePairingOutcome,?[\s\S]{0,200}\} from "\.\/connection-shell-model";/,
    );
  });

  it("handleSubmit: derives the outcome from the real connect attempt, bails on a non-'connected' outcome before saving or navigating, and otherwise saves through saveHostProfile with the real storage adapters then navigates to outcome.href", () => {
    const body = readFunctionCode("handleSubmit");
    expect(body).toMatch(/const attempt = await store\.connect\(result\.draft\.parsed\);/);
    expect(body).toMatch(
      /const outcome = deriveConnectSubmitOutcome\(result\.draft, undefined, attempt\);/,
    );
    expect(body).toMatch(/if \(outcome\.kind !== "connected"\) return;/);
    expect(body).toMatch(
      /await saveHostProfile\(\s*\{\s*plainStorage: keyValueStorage, secureStorage\s*\},\s*outcome\.profile,\s*outcome\.secrets,\s*\);/,
    );
    expect(body).toMatch(/router\.replace\(outcome\.href\);/);
  });

  it("handleSubmit's early return runs before any saveHostProfile/router.replace call in its source order", () => {
    const body = readFunctionCode("handleSubmit");
    const bailIndex = body.indexOf('if (outcome.kind !== "connected") return;');
    const saveIndex = body.indexOf("await saveHostProfile(");
    const navigateIndex = body.indexOf("router.replace(outcome.href);");
    expect(bailIndex).toBeGreaterThan(-1);
    expect(bailIndex).toBeLessThan(saveIndex);
    expect(saveIndex).toBeLessThan(navigateIndex);
  });

  // T32S14: `result.mode === "existing"` used to be unreachable dead
  // code (an early return with a comment saying so) — this proves
  // handleSubmit now actually forwards it to a real handleReconnect
  // call, before any of the "new profile" connect logic below it runs.
  it("handleSubmit forwards an 'existing' mode result to handleReconnect, before the fresh-connect logic, and returns without falling through to it", () => {
    const body = readFunctionCode("handleSubmit");
    expect(body).toMatch(
      /if \(result\.mode === "existing"\) \{\s*await handleReconnect\(result\.profile\);\s*return;\s*\}/,
    );
    const branchIndex = body.indexOf('if (result.mode === "existing")');
    const connectIndex = body.indexOf("await store.connect(");
    expect(branchIndex).toBeGreaterThan(-1);
    expect(branchIndex).toBeLessThan(connectIndex);
  });

  it("handleReconnect: resolves the selected option back to the saved HostProfileRecord, loads its secrets, calls the real reconnectHostProfile, and on success adopts the lifecycle and navigates", () => {
    const body = readFunctionCode("handleReconnect");
    expect(body).toMatch(
      /const profile = profiles\.find\(\(candidate\) => candidate\.id === selected\.id\);/,
    );
    expect(body).toMatch(
      /const secrets = await loadHostProfileSecrets\(\s*\{\s*plainStorage: keyValueStorage, secureStorage\s*\},\s*profile\.id,\s*\);/,
    );
    expect(body).toMatch(/const result = await reconnectHostProfile\(profile, secrets\);/);
    expect(body).toMatch(/const outcome = deriveReconnectOutcome\(profile, result\);/);
    // P5-W20 merge gate: `outcome.path` is passed through now. T66
    // produces it and `deriveReconnectOutcome` threads it here, but this
    // call site used to drop it, publishing every reconnect — direct
    // profiles included — as `path: "relay"`.
    //
    // T73: `profile` is now passed as a third argument too, so
    // `daemon-connection-store.ts` can reconstruct `daemonAddress` from
    // its `endpoint` on the `path === "direct"` branch.
    expect(body).toMatch(
      /await store\.adoptLifecycle\(outcome\.lifecycle, outcome\.path, profile\);/,
    );
    expect(body).toMatch(/router\.replace\(outcome\.href\);/);
  });

  it("handleReconnect: a 'failed' outcome sets reconnectError and returns before ever calling adoptLifecycle or router.replace", () => {
    const body = readFunctionCode("handleReconnect");
    const failIndex = body.indexOf('if (outcome.kind === "failed")');
    const setErrorIndex = body.indexOf("setReconnectError(outcome.error);");
    const adoptIndex = body.indexOf(
      "await store.adoptLifecycle(outcome.lifecycle, outcome.path, profile);",
    );
    expect(failIndex).toBeGreaterThan(-1);
    expect(adoptIndex).toBeGreaterThan(-1);
    expect(setErrorIndex).toBeGreaterThan(failIndex);
    expect(setErrorIndex).toBeLessThan(adoptIndex);
  });

  it("reconnectHostProfile is destructured from useAppCore(), the real T66/T32S14 AppCore mount, never a locally constructed one", () => {
    expect(readCode()).toMatch(
      /const \{ connection: store, keyValueStorage, secureStorage, reconnectHostProfile \} = useAppCore\(\);/,
    );
  });

  it("loads the real saved-profile list on mount via listHostProfiles, and maps it to ConnectProfileOption for ConnectForm's profiles prop", () => {
    const code = readCode();
    expect(code).toMatch(
      /void listHostProfiles\(\{ plainStorage: keyValueStorage, secureStorage \}\)\.then\(/,
    );
    expect(code).toMatch(
      /profiles\.map\(\(profile\) => \(\{ id: profile\.id, label: profile\.label \}\)\)/,
    );
    expect(code).toMatch(
      /<ConnectForm testId="connect-form" onSubmit=\{handleSubmit\} profiles=\{profileOptions\} \/>/,
    );
  });

  it("renders a reconnectError Banner distinct from the connect-status error Banner", () => {
    const code = readCode();
    expect(code).toMatch(
      /<Banner\s+tone="danger"\s+message=\{reconnectError\}\s+testId="connection-shell-reconnect-error-banner"\s*\/>/,
    );
  });

  it("handlePaired: derives the pairing outcome and saves/navigates the same way handleSubmit's success branch does", () => {
    const body = readFunctionCode("handlePaired");
    expect(body).toMatch(/const outcome = derivePairingOutcome\(result\);/);
    expect(body).toMatch(
      /await saveHostProfile\(\s*\{\s*plainStorage: keyValueStorage, secureStorage\s*\},\s*outcome\.profile,\s*outcome\.secrets,\s*\);/,
    );
    expect(body).toMatch(/router\.replace\(outcome\.href\);/);
  });

  it("wires QrPairingPanel's onPaired prop to handlePaired, not an inline adoptLifecycle-only handler", () => {
    expect(readCode()).toMatch(/onPaired=\{\(result\) => void handlePaired\(result\)\}/);
  });

  it("T329: the form's ScrollView delivers a tap that follows typing to the button, not to dismissing the keyboard", () => {
    // Comment-stripped, so the explanatory comment beside the prop cannot
    // satisfy this on its own.
    const code = readCode()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).toMatch(/<ScrollView[^>]*keyboardShouldPersistTaps="handled"/);
  });

  it("T330: shrinks the ScrollView viewport by the live keyboard inset, since edge-to-edge never resizes the window", () => {
    const code = readCode()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).toMatch(/const keyboardInset = useKeyboardInset\(\);/);
    expect(code).toMatch(
      /<ScrollView[^>]*style=\{\[styles\.root, \{ marginBottom: keyboardInset \}\]\}/,
    );
  });

  it("never logs a host, port, token, or pairing URL — no logger/console call anywhere in this file", () => {
    expect(readCode()).not.toMatch(/console\.(log|info|warn|error|debug)/);
    expect(readCode()).not.toMatch(/\blogger\b/i);
  });
});
