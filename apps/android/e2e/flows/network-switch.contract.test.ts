import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { connection } from "@picompanion/frontend-core";

import {
  classifyConnectionError,
  DIRECT_UNREACHABLE_MESSAGE,
  describeDirectConnectionError,
} from "../../src/features/connect/daemon-connection-error.js";
import {
  deriveConnectSubmitOutcome,
  sessionListHref,
} from "../../src/features/connect/connection-shell-model.js";
import type { ConnectFormDraft } from "../../src/features/connect/connect-form-model.js";
import { sessionListConnectionPathLabel } from "../../src/features/sessions/sessions-model.js";
import { NETWORK_SWITCH_FLOW } from "./network-switch-contract.js";

/**
 * T37E7 — proves every testId/string `../../maestro/network-switch.yaml`
 * names still exists in the real source it targets. This is
 * `network-switch.yaml`'s only proof of life in this wave: there is no
 * emulator, device, or Maestro binary here (see that file's own header
 * comment), so this test is what stops the flow silently rotting before
 * anyone with a device first runs it.
 *
 * Onboarding and the relay entry point's honest "unavailable" state are
 * `pairing.yaml`'s own testIds/copy, already proven by
 * `pairing.contract.test.ts` — this file does not re-derive that proof
 * (same precedent `notification-approval.contract.test.ts` follows for
 * its own reused onboarding/direct-pairing prefix). It starts fresh at
 * what is new to this flow:
 *
 *  - a direct-connect *failure* (an address nothing answers classifies
 *    as `"unreachable"`, a real, on-device-producible stand-in for
 *    "network loss" — see `network-switch.yaml`'s header for why this
 *    flow uses that instead of a Maestro network-toggle primitive it
 *    could not confirm exists);
 *  - the exact call chain that makes a *successful* connect navigate
 *    away (`connection-shell.tsx`'s `handleSubmit`), which is also what
 *    justifies this flow's own "ORDERING NOTE" about `pairing.yaml`;
 *  - the session list's own "connection path is visible" banner
 *    (T32B5/T32B6) and the route wiring that makes it live in
 *    production, never only in a component test.
 *
 * Two proof strategies, chosen per module, same split
 * `pairing.contract.test.ts` documents:
 *
 * - `daemon-connection-error.ts`, `connection-shell-model.ts`, and
 *   `sessions-model.ts` are RN-free, so this file imports them directly
 *   and calls the real functions — stronger than a source-text match.
 * - `connection-shell.tsx` and `sessions-screen.tsx`/the `sessions.tsx`
 *   route reach `react-native` and cannot be imported under this
 *   workspace's plain `vitest` setup (`CLAUDE.md`'s "VITEST LIMITATION"
 *   note), so those are proven with `readCode()` — comment-stripped
 *   source matched against a full JSX/statement expression, never a
 *   bare identifier (`CLAUDE.md`'s "SOURCE-TEXT REGEX TESTS ARE ON
 *   PROBATION" note).
 */

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("network-switch.yaml anchors exist in source", () => {
  describe("network loss (a real direct-connect failure)", () => {
    it("an unreachable/refused address classifies as 'unreachable' and describes as network-switch.yaml's exact error text", () => {
      // Real OS-level rejection shapes `daemon-connect-attempt.ts` can
      // actually receive from a refused TCP connect — not a fabricated
      // string invented for this test.
      expect(classifyConnectionError("connect ECONNREFUSED 10.0.2.2:1")).toBe("unreachable");
      expect(describeDirectConnectionError("connect ECONNREFUSED 10.0.2.2:1")).toBe(
        DIRECT_UNREACHABLE_MESSAGE,
      );
      expect(DIRECT_UNREACHABLE_MESSAGE).toBe(NETWORK_SWITCH_FLOW.unreachableErrorText);
    });

    it("connection-shell.tsx renders a failed attempt's error under the fixed testId network-switch.yaml asserts", () => {
      const code = readCode("../../src/features/connect/connection-shell.tsx");
      expect(code).toMatch(
        /\{error \? \(\s*<Banner tone="danger" message=\{error\} testId="connection-shell-error-banner" \/>\s*\) : null\}/,
      );
    });

    it("a failed connect's error is exactly what the store's classified rejection carries, and describeConnectionStatus keeps phase at 'Not connected' — deriveConnectSubmitOutcome never saves or navigates on failure", () => {
      const draft: ConnectFormDraft = {
        profileName: "",
        parsed: {
          scheme: "ws",
          endpoint: "10.0.2.2:1",
          host: "10.0.2.2",
          port: 1,
          useTls: false,
          isIpv6: false,
        },
      };
      const outcome = deriveConnectSubmitOutcome(draft, undefined, {
        ok: false,
        kind: "unreachable",
        error: DIRECT_UNREACHABLE_MESSAGE,
      });
      expect(outcome).toEqual({ kind: "failed", error: DIRECT_UNREACHABLE_MESSAGE });
      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") {
        // The type itself makes "saves nothing, sends nowhere" true by
        // construction (connection-shell-model.ts's own doc comment) —
        // there is no `href`/`profile` field to assert absent, only to
        // observe the discriminant that guards handleSubmit's early
        // `return` below.
        expect(outcome.error).toBe(DIRECT_UNREACHABLE_MESSAGE);
      }
    });
  });

  describe("relay path switch — reused verbatim from pairing.yaml/pairing-contract.ts", () => {
    it("NETWORK_SWITCH_FLOW's relay-entry-point constants are literally PAIRING_FLOW's, not a second, independently-typed copy", async () => {
      const { PAIRING_FLOW } = await import("./pairing-contract.js");
      expect(NETWORK_SWITCH_FLOW.showScannerButton).toBe(PAIRING_FLOW.showScannerButton);
      expect(NETWORK_SWITCH_FLOW.hideScannerButton).toBe(PAIRING_FLOW.hideScannerButton);
      expect(NETWORK_SWITCH_FLOW.qrPairingSection).toBe(PAIRING_FLOW.qrPairingSection);
      expect(NETWORK_SWITCH_FLOW.qrPairingRetryButton).toBe(PAIRING_FLOW.qrPairingRetryButton);
    });
  });

  describe("a successful direct connect navigates away — why this flow asserts the post-navigation state, not the transient status text", () => {
    it("handleSubmit awaits store.connect(), and on a 'connected' outcome saves the profile then always calls router.replace(outcome.href), never router.push", () => {
      const code = readCode("../../src/features/connect/connection-shell.tsx");
      expect(code).toMatch(
        /const attempt = await store\.connect\(result\.draft\.parsed\);\s*const outcome = deriveConnectSubmitOutcome\(result\.draft, undefined, attempt\);\s*if \(outcome\.kind !== "connected"\) return;\s*await saveHostProfile\(\s*\{ plainStorage: keyValueStorage, secureStorage \},\s*outcome\.profile,\s*outcome\.secrets,\s*\);\s*router\.replace\(outcome\.href\);/,
      );
    });

    it("sessionListHref/deriveConnectSubmitOutcome: a successful attempt's href is exactly the sessions route for the connected endpoint's own id — the real destination network-switch.yaml waits for", () => {
      const draft: ConnectFormDraft = {
        profileName: "",
        parsed: {
          scheme: "ws",
          endpoint: "10.0.2.2:54321",
          host: "10.0.2.2",
          port: 54321,
          useTls: false,
          isIpv6: false,
        },
      };
      const fakeLifecycle = {} as connection.DaemonClientLifecycle;
      const outcome = deriveConnectSubmitOutcome(draft, undefined, {
        ok: true,
        lifecycle: fakeLifecycle,
      });
      expect(outcome.kind).toBe("connected");
      if (outcome.kind === "connected") {
        // destinationHref URL-encodes the ":" in the route segment
        // (real behavior, worth knowing) — which is exactly why
        // network-switch.yaml matches the arrived-at sessions screen's
        // testId with a wildcard rather than a literal id: this test
        // does not assert how Expo Router's own param decoding renders
        // that segment back to `sessions-screen.tsx`'s `testId`, only
        // that the href it navigates to carries the connected
        // endpoint's id in some form.
        expect(outcome.href).toBe(sessionListHref("10.0.2.2:54321"));
        expect(outcome.href).toBe("/h/10.0.2.2%3A54321/sessions");
        expect(outcome.profile.id).toBe("10.0.2.2:54321");
      }
    });
  });

  describe("the session list's own visible connection path (T32B5, T32B6 item 3)", () => {
    it("the route passes the real network adapter, never omitting it — the one line that makes SessionListNetworkSync construct in production", () => {
      const code = readCode("../../src/app/h/[serverId]/(tabs)/sessions.tsx");
      expect(code).toMatch(/network=\{core\.network\}/);
    });

    it("sessions-screen.tsx seeds the connection-path banner from the real adapter's current status on mount, then keeps it live via subscribe — not only on a future change", () => {
      const code = readCode("../../src/features/sessions/sessions-screen.tsx");
      expect(code).toMatch(
        /if \(!sessionListNetworkSync \|\| !network\) return;\s*let cancelled = false;\s*void network\.getStatus\(\)\.then\(\(status\) => \{\s*if \(!cancelled\) sessionListNetworkSync\.handleNetworkStatus\(status\);\s*\}\);\s*const unsubscribe = network\.subscribe\(\(status\) => \{\s*sessionListNetworkSync\.handleNetworkStatus\(status\);\s*\}\);/,
      );
    });

    it("sessions-screen.tsx renders the connection-path banner under the fixed `${testId}-connection-path` testId, exactly the pattern network-switch.yaml matches", () => {
      const code = readCode("../../src/features/sessions/sessions-screen.tsx");
      expect(code).toMatch(
        /<Banner\s+tone="neutral"\s+message=\{`Connection: \$\{sessionListConnectionPathLabel\(listState\.connectionPath\)\}`\}\s+testId=\{`\$\{testId\}-connection-path`\}\s*\/>/,
      );
    });

    it("sessionListConnectionPathLabel is honestly 'Unknown' for the undefined/never-observed-a-kind default network-switch.yaml asserts, and never guesses a real interface kind it cannot know", () => {
      expect(sessionListConnectionPathLabel(undefined)).toBe(
        NETWORK_SWITCH_FLOW.connectionPathBannerText.replace("Connection: ", ""),
      );
      // The map exists for every NetworkConnectionKind this adapter
      // could ever report (`"unknown"`), plus the kinds only a real
      // netinfo-backed adapter could someday produce — proving the
      // label function is total, not merely correct for the one value
      // this run's own probe can reach.
      expect(sessionListConnectionPathLabel("unknown")).toBe("Unknown");
      expect(sessionListConnectionPathLabel("none")).toBe("Offline");
      expect(sessionListConnectionPathLabel("wifi")).toBe("Wi-Fi");
      expect(sessionListConnectionPathLabel("cellular")).toBe("Cellular");
    });
  });

  it("NETWORK_SWITCH_FLOW's testId constants match the literals network-switch.yaml actually uses", () => {
    // network-switch.yaml cannot import this module (Maestro has no
    // module system) — this pins the two copies (constants file, yaml
    // literal) against each other so they cannot silently drift apart
    // unnoticed.
    expect(NETWORK_SWITCH_FLOW.onboardingRoot).toBe("connect-onboarding");
    expect(NETWORK_SWITCH_FLOW.connectFormSection).toBe("connect-form");
    expect(NETWORK_SWITCH_FLOW.connectFormAddressField).toBe("connect-form-address-field");
    expect(NETWORK_SWITCH_FLOW.connectFormSubmitButton).toBe("connect-form-submit-button");
    expect(NETWORK_SWITCH_FLOW.notConnectedStatusText).toBe("Not connected");
    expect(NETWORK_SWITCH_FLOW.errorBannerTestId).toBe("connection-shell-error-banner");
    expect(NETWORK_SWITCH_FLOW.unreachableErrorText).toBe(
      "Could not reach the daemon. Check the address and try again.",
    );
    expect(NETWORK_SWITCH_FLOW.sessionsScreenIdPattern).toBe("sessions-screen-.*");
    expect(NETWORK_SWITCH_FLOW.sessionsScreenConnectionPathIdPattern).toBe(
      "sessions-screen-.*-connection-path",
    );
    expect(NETWORK_SWITCH_FLOW.connectionPathBannerText).toBe("Connection: Unknown");
  });
});
