import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Pins `global.css`'s `body` type baseline (`font-size: 13px;
 * -webkit-font-smoothing: antialiased;`), added without a test alongside it.
 * `global.css`'s own comment on the rule already gives the reach: five
 * sibling stylesheets — `apps/web/src/features/extensions/placements/
 * placements.css`, `features/connect/connect.css`, `features/connect/
 * qr-capture.css`, `features/rail/pi-extension-status-strip.css`, and
 * `features/transcript/recovered-turn-banner.css` — declare no font-size of
 * their own anywhere in the file, so any text they paint directly now
 * inherits this baseline for the first time; nothing pinned either
 * declaration before this test.
 *
 * A CSS file is pinned by reading its declared rule text, never by
 * `getComputedStyle` — jsdom does not load stylesheets — the same
 * `readFileSync` + `ruleBodyFor` pattern `apps/web/src/features/rail/
 * pi-extension-rail.test.tsx` already uses for `pi-extension-rail.css`.
 */

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "global.css"), "utf8");

const ruleBodyFor = (selector: string) => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = stripped.indexOf(`${selector} {`);
  expect(at, `${selector} not found in global.css`).toBeGreaterThanOrEqual(0);
  const close = stripped.indexOf("}", at);
  expect(close, `${selector} has no closing brace`).toBeGreaterThan(at);
  return stripped.slice(at, close);
};

describe("global.css body type baseline", () => {
  it("sets font-size to the --font-size-lg token (13px), not left at the browser default", () => {
    expect(ruleBodyFor("body")).toMatch(/font-size:\s*var\(--font-size-lg\)/);
  });

  it("sets -webkit-font-smoothing: antialiased", () => {
    expect(ruleBodyFor("body")).toMatch(/-webkit-font-smoothing:\s*antialiased/);
  });
});
