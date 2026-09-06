import { describe, expect, it } from "vitest";

import {
  ADDRESS_FIELD_HINT,
  buildErrorSummaryMessage,
  buildProfileSelectOptions,
  NEW_PROFILE_ID,
  parseConnectAddress,
  validateConnectForm,
  type ConnectProfileOption,
} from "./connect-form-model";

describe("parseConnectAddress", () => {
  it("parses a plain ws:// address", () => {
    expect(parseConnectAddress("ws://localhost:6767")).toEqual({
      ok: true,
      value: {
        scheme: "ws",
        host: "localhost",
        port: 6767,
        useTls: false,
        isIpv6: false,
        endpoint: "localhost:6767",
      },
    });
  });

  it("parses a wss:// address as TLS", () => {
    const result = parseConnectAddress("wss://example.com:443");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.useTls).toBe(true);
      expect(result.value.endpoint).toBe("example.com:443");
    }
  });

  it("parses a bracketed IPv6 host", () => {
    const result = parseConnectAddress("ws://[::1]:6767");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ host: "::1", port: 6767, isIpv6: true });
      expect(result.value.endpoint).toBe("[::1]:6767");
    }
  });

  it("trims surrounding whitespace", () => {
    const result = parseConnectAddress("  ws://localhost:6767  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.host).toBe("localhost");
  });

  // The task's own acceptance criteria name these four rejections
  // explicitly: "reject a missing scheme, a bad port, a non-numeric
  // port, an empty host."
  it("rejects an empty host address", () => {
    const result = parseConnectAddress("");
    expect(result).toEqual({
      ok: false,
      kind: "empty-host",
      error: "Enter a host address, like ws://192.168.1.10:6767.",
    });
  });

  it("rejects a whitespace-only address as empty", () => {
    const result = parseConnectAddress("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("empty-host");
  });

  it("rejects an address missing a scheme", () => {
    const result = parseConnectAddress("localhost:6767");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("missing-scheme");
      expect(result.error).toContain("ws://");
      expect(result.error).toContain("wss://");
    }
  });

  it("rejects an unsupported scheme", () => {
    const result = parseConnectAddress("http://localhost:6767");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unsupported-scheme");
      expect(result.error).toContain("http://");
    }
  });

  it("rejects an address with a scheme but no host", () => {
    const result = parseConnectAddress("ws://");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("empty-host");
  });

  it("rejects a host with no port at all", () => {
    const result = parseConnectAddress("ws://localhost");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("missing-port");
  });

  it("rejects a trailing colon with no port digits", () => {
    const result = parseConnectAddress("ws://localhost:");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("missing-port");
  });

  it("rejects a non-numeric port", () => {
    const result = parseConnectAddress("ws://localhost:abc");
    expect(result).toEqual({
      ok: false,
      kind: "non-numeric-port",
      error: "Port must be a number, like ws://192.168.1.10:6767.",
    });
  });

  it("rejects a port of 0", () => {
    const result = parseConnectAddress("ws://localhost:0");
    expect(result).toEqual({
      ok: false,
      kind: "port-out-of-range",
      error: "Port must be between 1 and 65535.",
    });
  });

  it("rejects a port above 65535", () => {
    const result = parseConnectAddress("ws://localhost:70000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("port-out-of-range");
  });

  it("rejects a malformed IPv6 host", () => {
    const result = parseConnectAddress("ws://[::1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("malformed-ipv6");
  });

  it("rejects an empty bracketed IPv6 host", () => {
    const result = parseConnectAddress("ws://[]:6767");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("empty-host");
  });
});

describe("buildProfileSelectOptions", () => {
  it("always leads with the New profile option", () => {
    const options = buildProfileSelectOptions([]);
    expect(options).toEqual([{ value: NEW_PROFILE_ID, label: "New profile" }]);
  });

  it("appends every saved profile after New profile, in order", () => {
    const profiles: ConnectProfileOption[] = [
      { id: "a", label: "Home daemon" },
      { id: "b", label: "Office daemon" },
    ];
    expect(buildProfileSelectOptions(profiles)).toEqual([
      { value: NEW_PROFILE_ID, label: "New profile" },
      { value: "a", label: "Home daemon" },
      { value: "b", label: "Office daemon" },
    ]);
  });
});

describe("validateConnectForm", () => {
  const profiles: ConnectProfileOption[] = [{ id: "a", label: "Home daemon" }];

  it("builds a new-profile draft from a valid address", () => {
    const result = validateConnectForm(
      { profileId: NEW_PROFILE_ID, profileName: "My daemon", address: "ws://localhost:6767" },
      [],
    );
    expect(result).toEqual({
      ok: true,
      mode: "new",
      draft: {
        profileName: "My daemon",
        parsed: {
          scheme: "ws",
          host: "localhost",
          port: 6767,
          useTls: false,
          isIpv6: false,
          endpoint: "localhost:6767",
        },
      },
    });
  });

  it("trims the profile name but does not require one", () => {
    const result = validateConnectForm(
      { profileId: NEW_PROFILE_ID, profileName: "  ", address: "ws://localhost:6767" },
      [],
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.mode === "new") {
      expect(result.draft.profileName).toBe("");
    }
  });

  it("returns a field-scoped address error for invalid input, and no other field", () => {
    const result = validateConnectForm(
      { profileId: NEW_PROFILE_ID, profileName: "", address: "localhost:6767" },
      [],
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        address:
          "Host address needs a scheme — start it with ws:// or wss://, like ws://192.168.1.10:6767.",
      },
    });
  });

  it("selects an existing profile without validating an address", () => {
    const result = validateConnectForm(
      { profileId: "a", profileName: "ignored", address: "not a valid address" },
      profiles,
    );
    expect(result).toEqual({
      ok: true,
      mode: "existing",
      profile: { id: "a", label: "Home daemon" },
    });
  });

  it("rejects an unknown profileId with a named error", () => {
    const result = validateConnectForm(
      { profileId: "does-not-exist", profileName: "", address: "" },
      profiles,
    );
    expect(result).toEqual({ ok: false, errors: { profileId: "Select a profile to continue." } });
  });
});

describe("buildErrorSummaryMessage", () => {
  it("returns undefined when there are no errors", () => {
    expect(buildErrorSummaryMessage({})).toBeUndefined();
  });

  it("returns the single message as-is when only one field has an error", () => {
    expect(buildErrorSummaryMessage({ address: "Enter a host address." })).toBe(
      "Enter a host address.",
    );
  });

  it("combines multiple field errors into one summary", () => {
    const summary = buildErrorSummaryMessage({
      profileId: "Select a profile to continue.",
      address: "Enter a host address.",
    });
    expect(summary).toBe(
      "Fix 2 problems before connecting: Select a profile to continue. Enter a host address.",
    );
  });
});

describe("ADDRESS_FIELD_HINT", () => {
  it("names both schemes and gives an example", () => {
    expect(ADDRESS_FIELD_HINT).toContain("ws://");
    expect(ADDRESS_FIELD_HINT).toContain("wss://");
    expect(ADDRESS_FIELD_HINT).toContain("192.168.1.10:6767");
  });
});
