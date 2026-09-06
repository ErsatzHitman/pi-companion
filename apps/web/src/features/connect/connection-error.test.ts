import { describe, expect, it } from "vitest";

import {
  DIRECT_UNKNOWN_MESSAGE,
  DIRECT_UNREACHABLE_MESSAGE,
  PASSWORD_REQUIRED_MESSAGE,
  RELAY_UNREACHABLE_MESSAGE,
  WRONG_DAEMON_KEY_MESSAGE,
  WRONG_PASSWORD_MESSAGE,
  classifyConnectionError,
  describeDirectConnectionError,
  describeRelayConnectionError,
} from "./connection-error.js";

describe("classifyConnectionError (T27A6)", () => {
  it("classifies the daemon's exact wrong-password close reasons", () => {
    // Exact strings `websocket-server.ts`'s `attachAuthenticatedSocket` sends.
    expect(classifyConnectionError("Incorrect password")).toBe("wrong-password");
    expect(classifyConnectionError("Password required")).toBe("wrong-password");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(classifyConnectionError("  incorrect PASSWORD  ")).toBe("wrong-password");
  });

  it("classifies the relay's exact decryption-failure reason as a wrong daemon key", () => {
    // Exact substring `crypto.ts`'s `decrypt()` throws, surfaced via
    // `encrypted-channel.ts`'s `handleMessage` catch closing with it.
    expect(classifyConnectionError("Decryption failed")).toBe("wrong-daemon-key");
  });

  it.each(["ECONNREFUSED", "Connection timed out", "Failed to connect", "Transport closed"])(
    "classifies %s as unreachable",
    (message) => {
      expect(classifyConnectionError(message)).toBe("unreachable");
    },
  );

  it("classifies an unrecognized message as unknown", () => {
    expect(classifyConnectionError("Something the backend never actually sends")).toBe("unknown");
  });

  it("classifies empty/missing input as unknown", () => {
    expect(classifyConnectionError("")).toBe("unknown");
    expect(classifyConnectionError(undefined)).toBe("unknown");
    expect(classifyConnectionError(null)).toBe("unknown");
  });
});

describe("describeDirectConnectionError vs describeRelayConnectionError (T27A6)", () => {
  it("gives a wrong password and a wrong daemon key different, correct messages", () => {
    const wrongPassword = describeDirectConnectionError("Incorrect password");
    const wrongDaemonKey = describeRelayConnectionError("Decryption failed");

    expect(wrongPassword).toBe(WRONG_PASSWORD_MESSAGE);
    expect(wrongDaemonKey).toBe(WRONG_DAEMON_KEY_MESSAGE);
    expect(wrongPassword).not.toBe(wrongDaemonKey);
  });

  it("describes a missing token distinctly from a wrong one, on both paths", () => {
    expect(describeDirectConnectionError("Password required")).toBe(PASSWORD_REQUIRED_MESSAGE);
    expect(describeRelayConnectionError("Password required")).toBe(PASSWORD_REQUIRED_MESSAGE);
  });

  it("describes an unreachable direct daemon distinctly from an expired relay pairing link", () => {
    const direct = describeDirectConnectionError("ECONNREFUSED");
    const relay = describeRelayConnectionError("ECONNREFUSED");

    expect(direct).toBe(DIRECT_UNREACHABLE_MESSAGE);
    expect(relay).toBe(RELAY_UNREACHABLE_MESSAGE);
    expect(direct).not.toBe(relay);
  });

  it("a direct connection's wrong-daemon-key classification (which should never occur in practice) still degrades to actionable copy, not relay wording", () => {
    expect(describeDirectConnectionError("Decryption failed")).toBe(DIRECT_UNKNOWN_MESSAGE);
  });

  it("falls back to a plain, actionable sentence for an unrecognized failure on either path", () => {
    expect(describeDirectConnectionError("weird backend error")).toBe(DIRECT_UNKNOWN_MESSAGE);
    expect(describeRelayConnectionError("weird backend error")).toBe(RELAY_UNREACHABLE_MESSAGE);
  });
});
