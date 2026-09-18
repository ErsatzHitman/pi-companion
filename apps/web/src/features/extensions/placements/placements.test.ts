import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Pins `placements.css`'s `.pi-extension-flow-block` rule — the web
 * counterpart of the spec's `.ext` rule (`border-radius: var(--r-blk);
 * background: var(--extension-bg); box-shadow: var(--sh-hairline);
 * padding: 12px 14px`, `--r-blk` 14px) — which shipped with no test of its
 * own. The four `PiExtension*.test.tsx` files already in this directory
 * (`PiExtensionInlineStack`, `PiExtensionScreenHost`, `PiExtensionSheetHost`,
 * plus `select-placement-elements.test.ts`) cover routing and rendering,
 * never this stylesheet's declared rule text.
 *
 * A CSS file is pinned by reading its declared rule text, never by
 * `getComputedStyle` — jsdom does not load stylesheets — the same
 * `readFileSync` + `ruleBodyFor` pattern `apps/web/src/features/rail/
 * pi-extension-rail.test.tsx` already uses for `pi-extension-rail.css`.
 */

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "placements.css"), "utf8");

const ruleBodyFor = (selector: string) => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = stripped.indexOf(`${selector} {`);
  expect(at, `${selector} not found in placements.css`).toBeGreaterThanOrEqual(0);
  const close = stripped.indexOf("}", at);
  expect(close, `${selector} has no closing brace`).toBeGreaterThan(at);
  return stripped.slice(at, close);
};

describe(".pi-extension-flow-block (spec .ext rule)", () => {
  const body = ruleBodyFor(".pi-extension-flow-block");

  it("uses the 14px big-block radius token, an exact match for the spec's --r-blk", () => {
    expect(body).toMatch(/border-radius:\s*var\(--radius-window\)/);
  });

  it("pads 12px/14px: the vertical figure via --spacing-3, the horizontal figure via a local custom property quoting the spec's literal", () => {
    expect(body).toMatch(/--pi-extension-flow-block-pad-inline:\s*14px/);
    expect(body).toMatch(
      /padding:\s*var\(--spacing-3\)\s*var\(--pi-extension-flow-block-pad-inline\)/,
    );
    // Not rounded to the nearest spacing token in either direction.
    expect(body).not.toMatch(/padding:\s*var\(--spacing-3\)\s*var\(--spacing-4\)/);
    expect(body).not.toMatch(/padding:\s*var\(--spacing-3\)\s*var\(--spacing-3\)/);
  });

  it("declares no raw hex colour", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
