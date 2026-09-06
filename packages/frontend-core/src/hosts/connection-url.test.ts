import { describe, expect, it } from "vitest";
import {
  alternateConnectionKind,
  buildConnectionUrlForKind,
  buildDirectConnectionUrl,
  buildRelayConnectionUrl,
  preferredConnectionKind,
  resolveConnectionTargets,
} from "./connection-url.js";
import type { HostProfile } from "./types.js";

function makeProfile(overrides: Partial<HostProfile> = {}): HostProfile {
  return {
    id: "host_1",
    label: "Test host",
    preferDirect: true,
    createdAt: 0,
    updatedAt: 0,
    lastConnectedAt: null,
    lastConnectionKind: null,
    ...overrides,
  };
}

describe("buildDirectConnectionUrl / buildRelayConnectionUrl", () => {
  it("builds a ws:// URL with the /ws path for a plain direct target", () => {
    expect(buildDirectConnectionUrl({ endpoint: "localhost:6767", useTls: false })).toBe(
      "ws://localhost:6767/ws",
    );
  });

  it("builds a wss:// URL when the direct target uses TLS", () => {
    // The URL serializer drops an explicit port matching the protocol's
    // default (443 for wss:), which is standard URL normalization, not a
    // functional difference.
    expect(buildDirectConnectionUrl({ endpoint: "example.test:8443", useTls: true })).toBe(
      "wss://example.test:8443/ws",
    );
  });

  it("builds a relay URL with serverId, client role, and protocol version query params", () => {
    const url = buildRelayConnectionUrl({
      endpoint: "relay.paseo.sh:443",
      useTls: true,
      serverId: "srv_abc123",
      daemonPublicKeyB64: "base64key==",
    });
    const parsed = new URL(url);
    expect(parsed.protocol).toBe("wss:");
    expect(parsed.pathname).toBe("/ws");
    expect(parsed.searchParams.get("serverId")).toBe("srv_abc123");
    expect(parsed.searchParams.get("role")).toBe("client");
    expect(parsed.searchParams.get("v")).toBe("2");
    // The daemon public key is pinning material for the transport, not a
    // URL-embeddable secret, and must never appear in the relay URL itself.
    expect(url).not.toContain("base64key");
  });
});

describe("resolveConnectionTargets", () => {
  it("prefers direct before relay when both are configured and preferDirect is true", () => {
    const profile = makeProfile({
      preferDirect: true,
      direct: { endpoint: "localhost:6767", useTls: false },
      relay: {
        endpoint: "relay.paseo.sh:443",
        useTls: true,
        serverId: "srv_1",
        daemonPublicKeyB64: "k",
      },
    });
    const targets = resolveConnectionTargets(profile);
    expect(targets.map((target) => target.kind)).toEqual(["direct", "relay"]);
  });

  it("prefers relay before direct when preferDirect is false", () => {
    const profile = makeProfile({
      preferDirect: false,
      direct: { endpoint: "localhost:6767", useTls: false },
      relay: {
        endpoint: "relay.paseo.sh:443",
        useTls: true,
        serverId: "srv_1",
        daemonPublicKeyB64: "k",
      },
    });
    const targets = resolveConnectionTargets(profile);
    expect(targets.map((target) => target.kind)).toEqual(["relay", "direct"]);
  });

  it("omits a kind with no configured connection details", () => {
    const profile = makeProfile({
      preferDirect: true,
      relay: {
        endpoint: "relay.paseo.sh:443",
        useTls: true,
        serverId: "srv_1",
        daemonPublicKeyB64: "k",
      },
    });
    expect(resolveConnectionTargets(profile).map((target) => target.kind)).toEqual(["relay"]);
  });

  it("returns an empty list for a profile with no configured connection", () => {
    expect(resolveConnectionTargets(makeProfile())).toEqual([]);
  });
});

describe("preferredConnectionKind / alternateConnectionKind", () => {
  const bothConfigured = makeProfile({
    preferDirect: true,
    direct: { endpoint: "localhost:6767", useTls: false },
    relay: {
      endpoint: "relay.paseo.sh:443",
      useTls: true,
      serverId: "srv_1",
      daemonPublicKeyB64: "k",
    },
  });

  it("reports the first target in resolution order as preferred", () => {
    expect(preferredConnectionKind(bothConfigured)).toBe("direct");
    expect(preferredConnectionKind(makeProfile())).toBeNull();
  });

  it("reports the other configured kind as the alternate", () => {
    expect(alternateConnectionKind(bothConfigured, "direct")).toBe("relay");
    expect(alternateConnectionKind(bothConfigured, "relay")).toBe("direct");
  });

  it("reports no alternate when only one kind is configured", () => {
    const directOnly = makeProfile({ direct: { endpoint: "localhost:6767", useTls: false } });
    expect(alternateConnectionKind(directOnly, "direct")).toBeNull();
  });
});

describe("buildConnectionUrlForKind", () => {
  it("throws a descriptive error for a kind the profile does not configure", () => {
    const directOnly = makeProfile({ direct: { endpoint: "localhost:6767", useTls: false } });
    expect(() => buildConnectionUrlForKind(directOnly, "relay")).toThrow(/no relay connection/i);
  });
});
