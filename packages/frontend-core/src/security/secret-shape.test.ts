import { describe, expect, it } from "vitest";

import { isSecretShaped, isSecretShapedKey, isSecretShapedValue } from "./secret-shape.js";

describe("the two proven holes, as regression tests", () => {
  it("hole 1 (tool-call-row-model.ts, T33A4): catches a secret embedded in a longer string, not just a value that IS the secret", () => {
    // The P5-W9 probe: a shell-ish unknown tool call's "command" argument
    // carries a Bearer token embedded inside a much longer string. The
    // old `^...$`-anchored value patterns missed this entirely.
    const command = "curl -H 'Authorization: Bearer sk-LIVEKEY1234567890' https://api.example.com";
    expect(isSecretShapedValue(command)).toBe(true);
    // Neither the anchoring fix nor the key check should matter here —
    // "command" itself is not a secret-shaped key name.
    expect(isSecretShapedKey("command")).toBe(false);
    expect(isSecretShaped(command, "command")).toBe(true);
  });

  it("hole 1, a second shape: the raw sk- token embedded without a Bearer clause", () => {
    const command = "echo $SECRET; call --token sk-abcdefghijklmnop 2>&1";
    expect(isSecretShapedValue(command)).toBe(true);
  });

  it("hole 2 (sqlite-structured-storage.ts, T37A): accessToken, refreshToken, relayPassword, sessionCookie all read as secret-shaped keys", () => {
    // The old key pattern was exact-match only, so a key that merely
    // *contains* one of these words (rather than *being* exactly one of
    // them) sailed through undetected.
    expect(isSecretShapedKey("accessToken")).toBe(true);
    expect(isSecretShapedKey("refreshToken")).toBe(true);
    expect(isSecretShapedKey("relayPassword")).toBe(true);
    expect(isSecretShapedKey("sessionCookie")).toBe(true);
  });
});

describe("isSecretShapedKey", () => {
  it("matches the exact words the original two pattern lists both recognized", () => {
    for (const key of [
      "password",
      "secret",
      "token",
      "passwd",
      "apiKey",
      "api_key",
      "relayKey",
      "daemonKey",
      "privateKey",
      "authorization",
      "auth",
      "credential",
      "bearer",
      "cookie",
    ]) {
      expect(isSecretShapedKey(key)).toBe(true);
    }
  });

  it("does not false-positive on a field name that merely contains 'key', like 'keyboard'", () => {
    // This exact case is asserted by sqlite-structured-storage.test.ts
    // against the real call site too — proven here at the source.
    expect(isSecretShapedKey("keyboardVisible")).toBe(false);
  });

  it("does not false-positive on ordinary field names", () => {
    for (const key of ["id", "title", "label", "endpoint", "useTls", "updatedAt", "status"]) {
      expect(isSecretShapedKey(key)).toBe(false);
    }
  });
});

describe("isSecretShapedValue", () => {
  it("recognizes a GitHub-style token even under an innocuous key (i.e. by shape alone)", () => {
    const ghToken = `ghp_${"a".repeat(36)}`;
    expect(isSecretShapedValue(ghToken)).toBe(true);
  });

  it("recognizes a Slack-style token inside an array element", () => {
    expect(isSecretShapedValue(`xoxb-${"1".repeat(20)}`)).toBe(true);
  });

  it("recognizes a JWT-shaped value", () => {
    const jwtLike =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(isSecretShapedValue(jwtLike)).toBe(true);
    expect(isSecretShapedValue(`Bearer ${jwtLike}`)).toBe(true);
  });

  it("recognizes a long hex or base64 blob when it IS the whole value", () => {
    expect(isSecretShapedValue("f0".repeat(16))).toBe(true); // 32 hex chars
    expect(isSecretShapedValue("A".repeat(41) + "==")).toBe(true);
  });

  it("does not flag ordinary long text, a file path, or a UUID", () => {
    expect(isSecretShapedValue("/synthetic/workspace/notes.txt")).toBe(false);
    expect(isSecretShapedValue("read the readme and summarize the architecture")).toBe(false);
    expect(isSecretShapedValue("4f6b2e2a-9c3a-4e1a-8f2b-1a2b3c4d5e6f")).toBe(false);
    // Long, but contains spaces — the whole-value hex/base64 patterns
    // never match text with word breaks, only an unbroken run of
    // base64/hex-charset characters.
    expect(isSecretShapedValue("read the readme and summarize the architecture ".repeat(50))).toBe(
      false,
    );
  });

  it("is a known limit, not a bug: a very long unbroken run of base64-charset characters with no separators reads as secret-shaped even when it is not one (e.g. a degenerate repeated character)", () => {
    // Documents the heuristic's edge, matching this module's doc-comment
    // ("A pattern list can never be complete" cuts both ways: false
    // negatives on novel secrets, and this — a rare false positive —
    // on plain text that happens to look exactly like unbroken base64).
    expect(isSecretShapedValue("x".repeat(10_000))).toBe(true);
  });

  it("does not flag an empty or whitespace-only string", () => {
    expect(isSecretShapedValue("")).toBe(false);
    expect(isSecretShapedValue("   ")).toBe(false);
  });
});

describe("isSecretShaped: the key-or-value combinator", () => {
  it("is true when the key alone is secret-shaped, regardless of the value's shape", () => {
    expect(isSecretShaped("not-a-known-shape-but-the-key-says-secret", "apiKey")).toBe(true);
  });

  it("is true when the value alone is secret-shaped, regardless of an innocuous key", () => {
    expect(isSecretShaped(`sk-${"x".repeat(48)}`, "value")).toBe(true);
  });

  it("is false when neither the key nor the value looks secret-shaped", () => {
    expect(isSecretShaped("read the readme", "note")).toBe(false);
  });

  it("works with no key hint at all", () => {
    expect(isSecretShaped(`sk-${"x".repeat(48)}`)).toBe(true);
    expect(isSecretShaped("read the readme")).toBe(false);
  });
});
