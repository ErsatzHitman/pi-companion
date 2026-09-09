import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T42A1 source-level coverage for `DevicesScreen.tsx`.
 *
 * `react-native` component modules can't be rendered under this
 * workspace's plain `vitest` setup (this repo's `CLAUDE.md`'s
 * "RN-in-vitest limitation" note) — like `DiagnosticsScreen.test.ts` and
 * `files-screen.test.ts`, this statically verifies the source contracts a
 * render pass would otherwise check. The real logic (fetch/degrade
 * behaviour, the allow-list projection, the push-status copy) is unit
 * tested directly in `trusted-devices-model.test.ts` and
 * `device-push-status-model.test.ts`.
 */
function readScreenSource(): string {
  return readFileSync(fileURLToPath(new URL("./DevicesScreen.tsx", import.meta.url)), "utf8");
}

/** Comment-stripped: this file's own doc comments quote several of the strings/identifiers the assertions below look for. */
function readScreenCode(): string {
  return readScreenSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("DevicesScreen source", () => {
  const source = readScreenSource();
  const code = readScreenCode();

  it("renders the trusted-device list driven by the model/hook, never a hand-typed row list", () => {
    expect(code).toMatch(/from\s+["']\.\/use-trusted-devices\.js["']/);
    expect(code).toMatch(/useTrustedDevices\(\{/);
    expect(code).toMatch(/rows\.map\(\(summary\)\s*=>/);
  });

  it("sorts and summarizes through the model, never inlining its own device formatting", () => {
    expect(code).toMatch(/sortTrustedDevices\(/);
    expect(code).toMatch(/summarizeTrustedDevice\(/);
  });

  it("renders this device's push status through describeDevicePushStatus, never a hand-typed sentence", () => {
    expect(code).toMatch(/from\s+["']\.\/use-device-push-status\.js["']/);
    expect(code).toMatch(/useDevicePushStatus\(\{/);
    expect(code).toMatch(/describeDevicePushStatus\(pushStatus\)/);
  });

  it("degrades to a named empty state for an unavailable client, never an error banner", () => {
    expect(code).toMatch(/snapshot\.status === "unavailable"/);
    expect(code).toMatch(/Device list unavailable/);
  });

  it("shows a real error state distinct from the unavailable/empty ones", () => {
    expect(code).toMatch(/snapshot\.status === "error"/);
    expect(code).toMatch(/<ErrorState/);
  });

  it("shows a named empty state when the list is genuinely empty", () => {
    expect(code).toMatch(/snapshot\.status === "loaded" && rows\.length === 0/);
    expect(code).toMatch(/No trusted devices/);
  });

  it("offers a manual refresh that refreshes both the device list and the push status", () => {
    expect(code).toMatch(/function handleRefresh\(\)/);
    expect(code).toMatch(/refreshDevices\(\)/);
    expect(code).toMatch(/refreshPushStatus\(\)/);
    expect(code).toMatch(/onPress=\{handleRefresh\}/);
  });

  it("marks this device's own row without filtering it out of the list", () => {
    expect(code).toMatch(/summary\.isThisDevice/);
    expect(code).toMatch(/This device/);
  });

  it("never renders a token, key, secret, password, or pin anywhere in its own source", () => {
    // This is a static floor, not a substitute for trusted-devices-model
    // .test.ts's allow-list mutation proof — it just proves the screen
    // itself never even mentions one of these identifiers.
    expect(code.toLowerCase()).not.toMatch(/\btoken\b/);
    expect(code.toLowerCase()).not.toMatch(/\bpassword\b/);
    expect(code.toLowerCase()).not.toMatch(/\bsecret\b/);
    expect(code.toLowerCase()).not.toMatch(/\bprivatekey\b/);
    expect(code.toLowerCase()).not.toMatch(/\bpin\b/);
  });

  it("declares no revoke affordance yet — that is T42A2's job, not this screen's", () => {
    expect(code).not.toMatch(/onRevoke/);
    expect(code).not.toMatch(/revokeTrustedDevice/);
    expect(code).not.toMatch(/Revoke/);
  });

  it("uses only theme tokens for colour, never a raw hex literal", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).toMatch(/theme\.colors\./);
  });

  it("declares a 48dp row touch target", () => {
    const minHeights = [...code.matchAll(/minHeight:\s*(\d+)\b/g)].map((match) => Number(match[1]));
    expect(minHeights.length).toBeGreaterThan(0);
    for (const value of minHeights) {
      expect(value).toBeGreaterThanOrEqual(48);
    }
  });

  it("makes the client id selectable text, since there is no clipboard-copy affordance on this platform yet", () => {
    expect(code).toMatch(/<Text[^>]*\bselectable\b/);
  });

  it("discloses, rather than hides, the current lack of a tap path into this screen", () => {
    expect(source).toMatch(/Nothing currently taps a UI element to reach this route/);
  });

  it("names the exact revocation seam T42A2 should add", () => {
    expect(source).toMatch(/T42A2/);
    expect(source).toMatch(/onRevoke\?:\s*\(clientId: string\) => void/);
  });

  it("is a named, importable export", () => {
    expect(code).toMatch(/export function DevicesScreen\(/);
    expect(code).toMatch(/export default DevicesScreen;/);
  });
});
