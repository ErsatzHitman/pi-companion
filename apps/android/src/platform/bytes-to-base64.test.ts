import { describe, expect, it } from "vitest";

import { base64ToBytes, bytesToBase64 } from "./bytes-to-base64.js";

describe("bytesToBase64", () => {
  it("matches known RFC 4648 vectors, including both padding lengths", () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe("");
    expect(bytesToBase64(new Uint8Array([0x66]))).toBe("Zg==");
    expect(bytesToBase64(new Uint8Array([0x66, 0x6f]))).toBe("Zm8=");
    expect(bytesToBase64(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe("Zm9v");
    expect(bytesToBase64(new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]))).toBe("Zm9vYmFy");
  });

  it("round-trips arbitrary bytes through the full alphabet range", () => {
    const allBytes = new Uint8Array(256).map((_, index) => index);
    const encoded = bytesToBase64(allBytes);
    expect(encoded.length % 4).toBe(0);
    // Node's own decoder is an independent oracle here.
    expect(Buffer.from(encoded, "base64").equals(Buffer.from(allBytes))).toBe(true);
  });

  it("base64ToBytes inverts bytesToBase64 for every length and across a long input", () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array([])))).toEqual(new Uint8Array([]));
    for (let length = 0; length < 40; length += 1) {
      const bytes = new Uint8Array(length).map((_, index) => (index * 37 + length) & 0xff);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
    const long = new Uint8Array(4096).map((_, index) => index & 0xff);
    expect(base64ToBytes(bytesToBase64(long))).toEqual(long);
  });

  it("base64ToBytes tolerates padding and embedded whitespace", () => {
    expect(base64ToBytes("aGk=")).toEqual(new Uint8Array([0x68, 0x69]));
    expect(base64ToBytes("aG k=")).toEqual(new Uint8Array([0x68, 0x69]));
  });
});
