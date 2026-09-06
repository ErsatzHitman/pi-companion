import type { connection } from "@picompanion/frontend-core";
import { testing } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import type { ConnectFormDraft } from "./connect-form-model.js";
import type { ConnectAttemptResult } from "./daemon-connect-attempt.js";
import type { ApplyConnectionOfferSuccess } from "./apply-connection-offer.js";
import type { HostProfileRecord } from "./credential-store.js";
import type { ReconnectResult } from "./host-profile-reconnect.js";
import {
  buildDirectHostProfile,
  buildRelayHostProfile,
  derivePairingOutcome,
  deriveConnectSubmitOutcome,
  deriveReconnectOutcome,
  directHostProfileSecrets,
  relayHostProfileSecrets,
  sessionListHref,
} from "./connection-shell-model.js";

/**
 * `connection-shell-model.ts` coverage — T32A8. Every case here proves a
 * *value* (the exact saved `HostProfileRecord`/`HostProfileSecrets` and
 * the exact href), never merely that a function returned something —
 * matching this wave's "registration is not receipt" standard.
 */

const DIRECT_DRAFT: ConnectFormDraft = {
  profileName: "",
  parsed: {
    scheme: "ws",
    host: "192.168.1.10",
    port: 6767,
    useTls: false,
    isIpv6: false,
    endpoint: "192.168.1.10:6767",
  },
};

const IPV6_DRAFT: ConnectFormDraft = {
  profileName: "My Studio",
  parsed: {
    scheme: "wss",
    host: "::1",
    port: 6767,
    useTls: true,
    isIpv6: true,
    endpoint: "[::1]:6767",
  },
};

const FAKE_LIFECYCLE = {} as connection.DaemonClientLifecycle;

describe("sessionListHref", () => {
  it("builds the /h/:serverId/sessions path for a profile id", () => {
    expect(sessionListHref("host_abc")).toBe("/h/host_abc/sessions");
  });
});

describe("buildDirectHostProfile", () => {
  it("uses the parsed endpoint as id and falls back to the host as label when no name was typed", () => {
    expect(buildDirectHostProfile(DIRECT_DRAFT)).toEqual({
      id: "192.168.1.10:6767",
      label: "192.168.1.10",
      kind: "direct",
      endpoint: "192.168.1.10:6767",
      useTls: false,
      isIpv6: false,
    });
  });

  it("uses the typed profile name as label and preserves useTls/isIpv6 for an IPv6, TLS address", () => {
    expect(buildDirectHostProfile(IPV6_DRAFT)).toEqual({
      id: "[::1]:6767",
      label: "My Studio",
      kind: "direct",
      endpoint: "[::1]:6767",
      useTls: true,
      isIpv6: true,
    });
  });
});

describe("directHostProfileSecrets", () => {
  it("carries the password when one was supplied", () => {
    expect(directHostProfileSecrets("hunter2")).toEqual({ password: "hunter2" });
  });

  it("is empty when no password was supplied", () => {
    expect(directHostProfileSecrets(undefined)).toEqual({});
  });
});

describe("deriveConnectSubmitOutcome", () => {
  it("on success: saves the built profile, an empty-secrets object (no password path yet), and the destination href", () => {
    const result: ConnectAttemptResult = { ok: true, lifecycle: FAKE_LIFECYCLE };
    const outcome = deriveConnectSubmitOutcome(DIRECT_DRAFT, undefined, result);
    expect(outcome).toEqual({
      kind: "connected",
      profile: {
        id: "192.168.1.10:6767",
        label: "192.168.1.10",
        kind: "direct",
        endpoint: "192.168.1.10:6767",
        useTls: false,
        isIpv6: false,
      },
      secrets: {},
      href: "/h/192.168.1.10%3A6767/sessions",
    });
  });

  it("on success with a password: the returned secrets carry it", () => {
    const result: ConnectAttemptResult = { ok: true, lifecycle: FAKE_LIFECYCLE };
    const outcome = deriveConnectSubmitOutcome(DIRECT_DRAFT, "hunter2", result);
    expect(outcome.kind).toBe("connected");
    expect(outcome).toMatchObject({ secrets: { password: "hunter2" } });
  });

  it("on failure: reports the named 'failed' state with the classified error, and carries no profile/secrets/href field at all", () => {
    const result: ConnectAttemptResult = {
      ok: false,
      kind: "unreachable",
      error: "Could not reach the daemon.",
    };
    const outcome = deriveConnectSubmitOutcome(DIRECT_DRAFT, undefined, result);
    expect(outcome).toEqual({ kind: "failed", error: "Could not reach the daemon." });
    expect(outcome).not.toHaveProperty("profile");
    expect(outcome).not.toHaveProperty("secrets");
    expect(outcome).not.toHaveProperty("href");
  });
});

const RELAY_FIXTURE = testing.buildRelayHostProfileFixture();
const RELAY_PROFILE = RELAY_FIXTURE.relay;
if (!RELAY_PROFILE) {
  throw new Error("testing.buildRelayHostProfileFixture() did not include a relay profile");
}

const PAIRING_SUCCESS: ApplyConnectionOfferSuccess = {
  ok: true,
  kind: "success",
  lifecycle: FAKE_LIFECYCLE,
  relay: RELAY_PROFILE,
  label: "Studio relay",
};

describe("buildRelayHostProfile", () => {
  it("uses the relay's own serverId as id, kind \"relay\", and the pairing's label", () => {
    expect(buildRelayHostProfile(PAIRING_SUCCESS)).toEqual({
      id: RELAY_PROFILE.serverId,
      label: "Studio relay",
      kind: "relay",
      endpoint: RELAY_PROFILE.endpoint,
      useTls: RELAY_PROFILE.useTls,
      isIpv6: false,
    });
  });

  it("detects a bracketed IPv6 relay endpoint", () => {
    const ipv6Result: ApplyConnectionOfferSuccess = {
      ...PAIRING_SUCCESS,
      relay: { ...RELAY_PROFILE, endpoint: "[2001:db8::1]:443" },
    };
    expect(buildRelayHostProfile(ipv6Result).isIpv6).toBe(true);
  });
});

describe("relayHostProfileSecrets (T66)", () => {
  it("carries the offer's daemonPublicKeyB64 as relayKey — the value a later reconnect must pin against", () => {
    expect(relayHostProfileSecrets(PAIRING_SUCCESS)).toEqual({
      relayKey: RELAY_PROFILE.daemonPublicKeyB64,
    });
  });
});

describe("derivePairingOutcome", () => {
  it('saves the relay profile (kind "relay"), the E2EE pin as relayKey, and the destination href keyed by the relay\'s serverId', () => {
    expect(derivePairingOutcome(PAIRING_SUCCESS)).toEqual({
      profile: {
        id: RELAY_PROFILE.serverId,
        label: "Studio relay",
        kind: "relay",
        endpoint: RELAY_PROFILE.endpoint,
        useTls: RELAY_PROFILE.useTls,
        isIpv6: false,
      },
      secrets: { relayKey: RELAY_PROFILE.daemonPublicKeyB64 },
      href: `/h/${RELAY_PROFILE.serverId}/sessions`,
    });
  });
});

/** Distinct object identity from `FAKE_LIFECYCLE` above — proves `deriveReconnectOutcome` forwards the exact reconnected lifecycle value, never a fresh/fabricated one. */
const RECONNECTED_LIFECYCLE = {} as connection.DaemonClientLifecycle;

const DIRECT_PROFILE: HostProfileRecord = {
  id: "192.168.1.10:6767",
  label: "Studio",
  kind: "direct",
  endpoint: "192.168.1.10:6767",
  useTls: false,
  isIpv6: false,
};

const RELAY_SAVED_PROFILE: HostProfileRecord = {
  id: RELAY_PROFILE.serverId,
  label: "Studio relay",
  kind: "relay",
  endpoint: RELAY_PROFILE.endpoint,
  useTls: RELAY_PROFILE.useTls,
  isIpv6: false,
};

describe("deriveReconnectOutcome (T32S14)", () => {
  it("a successful direct reconnect: the real lifecycle and path arrive unmodified, with the href keyed by the profile's own id — registration is not receipt", () => {
    const result: ReconnectResult = {
      ok: true,
      lifecycle: RECONNECTED_LIFECYCLE,
      path: "direct",
    };
    const outcome = deriveReconnectOutcome(DIRECT_PROFILE, result);
    expect(outcome).toEqual({
      kind: "reconnected",
      lifecycle: RECONNECTED_LIFECYCLE,
      path: "direct",
      href: sessionListHref(DIRECT_PROFILE.id),
    });
    // Not merely equal by shape — the exact same object the reconnect
    // attempt produced, never a copy or a placeholder.
    if (outcome.kind === "reconnected") {
      expect(outcome.lifecycle).toBe(RECONNECTED_LIFECYCLE);
    }
  });

  it("a successful relay reconnect: path is 'relay', href still keyed by the saved profile's id", () => {
    const result: ReconnectResult = {
      ok: true,
      lifecycle: RECONNECTED_LIFECYCLE,
      path: "relay",
    };
    const outcome = deriveReconnectOutcome(RELAY_SAVED_PROFILE, result);
    expect(outcome).toEqual({
      kind: "reconnected",
      lifecycle: RECONNECTED_LIFECYCLE,
      path: "relay",
      href: `/h/${RELAY_SAVED_PROFILE.id}/sessions`,
    });
  });

  it("a pin-mismatch failure: pinMismatch and the fixed relay-reconnect copy pass through unmodified, never conflated with 'unreachable'", () => {
    const result: ReconnectResult = {
      ok: false,
      kind: "wrong-daemon-key",
      error: "This saved connection's security key no longer matches the daemon behind the relay.",
      pinMismatch: true,
    };
    const outcome = deriveReconnectOutcome(RELAY_SAVED_PROFILE, result);
    expect(outcome).toEqual({
      kind: "failed",
      error: result.error,
      pinMismatch: true,
    });
    expect(outcome).not.toHaveProperty("lifecycle");
    expect(outcome).not.toHaveProperty("href");
  });

  it("a merely-unreachable failure: pinMismatch is false, never conflated with a pin mismatch", () => {
    const result: ReconnectResult = {
      ok: false,
      kind: "unreachable",
      error: "Could not reach the daemon.",
      pinMismatch: false,
    };
    const outcome = deriveReconnectOutcome(DIRECT_PROFILE, result);
    expect(outcome).toEqual({
      kind: "failed",
      error: "Could not reach the daemon.",
      pinMismatch: false,
    });
  });
});
