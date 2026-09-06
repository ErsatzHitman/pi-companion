import { describe, expect, it } from "vitest";

import { parseHostAddress, validateConnectForm } from "./validate-connect-form.js";

describe("parseHostAddress", () => {
  it("parses host:port", () => {
    expect(parseHostAddress("localhost:6767")).toEqual({
      host: "localhost",
      port: 6767,
      isIpv6: false,
    });
  });

  it("parses bracketed IPv6 addresses", () => {
    expect(parseHostAddress("[::1]:6767")).toEqual({ host: "::1", port: 6767, isIpv6: true });
  });

  it("trims surrounding whitespace", () => {
    expect(parseHostAddress("  localhost:6767  ")).toEqual({
      host: "localhost",
      port: 6767,
      isIpv6: false,
    });
  });

  it("rejects an empty address", () => {
    expect(() => parseHostAddress("")).toThrow("Enter a host address.");
    expect(() => parseHostAddress("   ")).toThrow("Enter a host address.");
  });

  it("rejects an address with no port", () => {
    expect(() => parseHostAddress("localhost")).toThrow(
      "Enter a host and port, like localhost:6767.",
    );
  });

  it("rejects a malformed IPv6 address", () => {
    expect(() => parseHostAddress("[::1]")).toThrow(
      "Enter an IPv6 host and port, like [::1]:6767.",
    );
  });

  it("rejects an out-of-range port", () => {
    expect(() => parseHostAddress("localhost:70000")).toThrow("Port must be between 1 and 65535.");
    expect(() => parseHostAddress("localhost:0")).toThrow("Port must be between 1 and 65535.");
  });

  it("rejects a non-numeric port", () => {
    expect(() => parseHostAddress("localhost:abc")).toThrow(
      "Enter a host and port, like localhost:6767.",
    );
  });
});

describe("validateConnectForm", () => {
  it("builds a draft from valid input", () => {
    const result = validateConnectForm({
      label: "My daemon",
      address: "localhost:6767",
      useTls: false,
    });
    expect(result).toEqual({
      ok: true,
      draft: {
        label: "My daemon",
        direct: { endpoint: "localhost:6767", useTls: false },
        preferDirect: true,
      },
    });
  });

  it("derives a label from the host when none is given", () => {
    const result = validateConnectForm({ label: "  ", address: "example.com:6767", useTls: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.label).toBe("example.com");
      expect(result.draft.direct.useTls).toBe(true);
    }
  });

  it("normalizes an IPv6 endpoint back into bracketed form", () => {
    const result = validateConnectForm({ label: "", address: "[::1]:6767", useTls: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.direct.endpoint).toBe("[::1]:6767");
    }
  });

  it("returns a field-scoped error for invalid input", () => {
    const result = validateConnectForm({ label: "", address: "not-an-address", useTls: false });
    expect(result).toEqual({
      ok: false,
      errors: { address: "Enter a host and port, like localhost:6767." },
    });
  });
});
