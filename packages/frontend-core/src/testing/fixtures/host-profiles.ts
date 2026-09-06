/**
 * Shared `HostProfile` fixture builders — plan.md §7.1/§12.1, T24.
 *
 * `apps/web`'s connect/pairing suite (T27A) and `apps/android`'s onboarding
 * suite (T32A) both need a deterministic, synthetic `HostProfile` to drive
 * their host-list/pairing UI in tests without a real daemon or
 * `SecureStorage`. Kept here (rather than duplicated in each app) so both
 * platforms exercise the exact same shape and both stay traceable to the
 * real `hosts/types.ts` contract.
 *
 * Deliberately contains no secret material: as `hosts/types.ts` documents,
 * a real `HostProfile` never carries a password or relay-authenticating
 * material itself, so these fixtures are safe to import into any test
 * bundle.
 */
import type {
  DirectHostConnectionProfile,
  HostProfile,
  RelayHostConnectionProfile,
} from "../../hosts/types.js";

const FIXED_TIMESTAMP_MS = Date.parse("2026-09-02T09:00:00.000Z");

/** A direct-only host profile fixture (loopback dev daemon shape). */
export function buildDirectHostProfileFixture(overrides: Partial<HostProfile> = {}): HostProfile {
  const direct: DirectHostConnectionProfile = { endpoint: "127.0.0.1:6768", useTls: false };
  return {
    id: "host_fixture_direct_0001",
    label: "Fixture direct host",
    direct,
    preferDirect: true,
    createdAt: FIXED_TIMESTAMP_MS,
    updatedAt: FIXED_TIMESTAMP_MS,
    lastConnectedAt: null,
    lastConnectionKind: null,
    ...overrides,
  };
}

/** A relay-only host profile fixture, as produced from a `ConnectionOffer`. */
export function buildRelayHostProfileFixture(overrides: Partial<HostProfile> = {}): HostProfile {
  const relay: RelayHostConnectionProfile = {
    endpoint: "relay.fixture.invalid:443",
    useTls: true,
    serverId: "srv_fixture_relay_0001",
    daemonPublicKeyB64: "Zml4dHVyZS1wdWJsaWMta2V5",
  };
  return {
    id: "host_fixture_relay_0001",
    label: "Fixture relay host",
    relay,
    preferDirect: false,
    createdAt: FIXED_TIMESTAMP_MS,
    updatedAt: FIXED_TIMESTAMP_MS,
    lastConnectedAt: null,
    lastConnectionKind: null,
    ...overrides,
  };
}

/** A host profile fixture with both a direct and a relay target configured. */
export function buildDualConnectionHostProfileFixture(
  overrides: Partial<HostProfile> = {},
): HostProfile {
  return {
    ...buildDirectHostProfileFixture(),
    ...buildRelayHostProfileFixture(),
    id: "host_fixture_dual_0001",
    label: "Fixture dual-connection host",
    ...overrides,
  };
}
