import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T340: `PortalHost` pads its overlays' bottom by a `bottomInset` prop,
 * so a bottom-aligned `Sheet` panel sits above the keyboard instead of
 * under it (Maestro run 34477213142's `notification-approval`: scrim
 * visible, `approvals-dialog` pruned as off screen).
 *
 * `Portal.tsx` imports `react-native`, which cannot be rendered under
 * this workspace's plain `vitest` setup — see `./Sheet.test.ts`'s doc
 * comment — so this is a source-level contract test, matched over the
 * comment-stripped code for the reason that file's `readCode` gives.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./Portal.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("PortalHost bottomInset (T340)", () => {
  it("accepts an optional bottomInset prop, defaulting to 0 (the pre-T340 overlay)", () => {
    const code = readCode();
    expect(code).toMatch(/bottomInset\?: number;/);
    expect(code).toMatch(
      /export function PortalHost\(\{ children, bottomInset = 0 \}: PortalHostProps\)/,
    );
  });

  it("pads every portaled overlay's bottom by it while keeping absoluteFill and box-none, so the scrim still covers the display", () => {
    const code = readCode();
    expect(code).toMatch(
      /<View\s+key=\{key\}\s+style=\{\[StyleSheet\.absoluteFill, \{ paddingBottom: bottomInset \}\]\}\s+pointerEvents="box-none"\s*>/,
    );
  });
});
