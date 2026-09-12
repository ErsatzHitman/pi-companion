/**
 * Standard base64 encoding of raw bytes — the one pure piece of
 * `expo-sharing-port.ts`'s `ShareableFile` → file-URI path.
 *
 * `expo-file-system`'s legacy `writeAsStringAsync` writes a local file from
 * a string, and the only string shape that preserves arbitrary bytes is
 * base64 (`{ encoding: EncodingType.Base64 }`). React Native's Hermes does
 * not ship a dependable global `btoa`/`Buffer`, and a `FileReader` data-URL
 * round-trip would be asynchronous for bytes already in hand, so this is a
 * small, synchronous, dependency-free encoder instead — and, because it
 * imports nothing, it is directly provable under plain `vitest`.
 */
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Reverse lookup from a base64 character to its 6-bit value; `-1` for anything else. Built once, at module load. */
const BASE64_VALUES: number[] = (() => {
  const values = Array.from({ length: 128 }, () => -1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    values[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  return values;
})();

/** Encodes `bytes` as a standard (RFC 4648) base64 string, with `=` padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = index + 1 < bytes.length ? bytes[index + 1]! : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2]! : 0;
    encoded += BASE64_ALPHABET[first >> 2]!;
    encoded += BASE64_ALPHABET[((first & 0b11) << 4) | (second >> 4)]!;
    encoded +=
      index + 1 < bytes.length ? BASE64_ALPHABET[((second & 0b1111) << 2) | (third >> 6)]! : "=";
    encoded += index + 2 < bytes.length ? BASE64_ALPHABET[third & 0b111111]! : "=";
  }
  return encoded;
}

/**
 * Decodes a standard (RFC 4648) base64 string — with or without `=` padding,
 * and tolerant of embedded whitespace — back into bytes. Invalid characters
 * are skipped rather than throwing: the only input in practice is a string
 * this module's own counterpart produced on the other side of the WebView
 * bridge, and a terminal keystroke that somehow corrupts is better dropped
 * than crashing the screen. Exported (rather than kept private to the
 * terminal port) because it is the exact inverse `bytesToBase64` above is
 * proven against.
 */
export function base64ToBytes(encoded: string): Uint8Array {
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (let index = 0; index < encoded.length; index += 1) {
    const code = encoded.charCodeAt(index);
    const value = code < 128 ? BASE64_VALUES[code]! : -1;
    if (value < 0) continue;
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
      // Keep only the bits still pending; without this the accumulator
      // overflows JavaScript's 32-bit bitwise range after a few characters.
      accumulator &= (1 << bits) - 1;
    }
  }
  return new Uint8Array(bytes);
}
