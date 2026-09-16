/**
 * Real-browser axe-core check for Playwright specs (plan.md §10.5: "Web
 * runs axe checks"). `apps/web`'s own component tests already run
 * `jest-axe` under jsdom; this is the equivalent check for a real,
 * live-rendered page, reusing the same underlying `axe-core` engine
 * `jest-axe` wraps (already a transitive dependency here -- no new
 * package needed) via `page.addScriptTag` instead of a jsdom shim.
 */
import { createRequire } from "node:module";

import type { Page } from "@playwright/test";

import { expect } from "./test.js";

interface AxeResult {
  id: string;
  description: string;
  nodes: Array<{ target: string[]; failureSummary?: string }>;
}

const AXE_SCRIPT_PATH = createRequire(import.meta.url).resolve("axe-core");

/**
 * Waits for every FINITE animation on the page to finish before a caller
 * samples computed colour.
 *
 * axe's `color-contrast` rule reads the composited foreground and
 * background at the instant it runs. An entrance animation that fades a
 * container in (`.connect-card`'s `pc-connect-fade-up`, which ramps
 * `opacity` 0 -> 1) therefore makes every colour inside that container
 * transiently fail: sampled mid-fade, the connect screen reported 147
 * `color-contrast` violations, including the primary button's own label at
 * 1.04:1, against composited values (`#8f9092`, `#fafafb`) that appear
 * nowhere in `packages/design-tokens/src/tokens.ts`. The tokens were never
 * wrong; the sample was taken before the page was at rest.
 *
 * Infinite animations are deliberately excluded rather than waited on: a
 * spinner or a pulsing status dot never reaches `finished`, so awaiting one
 * would hang until the test timeout. Their own contrast is a property of
 * the token pair, not of the frame.
 */
async function waitForAnimationsToSettle(page: Page): Promise<void> {
  // The callback runs in the browser, but is typechecked by `e2e/tsconfig.json`,
  // which carries no `DOM` lib — the same reason `expectNoAxeViolations` below
  // reaches `axe` through a cast on `globalThis` rather than a global.
  await page.evaluate(async () => {
    interface PageAnimation {
      readonly finished: Promise<unknown>;
      readonly effect: { getTiming(): { iterations?: number } } | null;
    }
    const doc = (globalThis as unknown as { document: { getAnimations(): PageAnimation[] } })
      .document;
    const finite = doc
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
}

/** Injects axe-core (once per page) and asserts zero violations for the current document. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  await waitForAnimationsToSettle(page);
  await page.addScriptTag({ path: AXE_SCRIPT_PATH });
  const violations = await page.evaluate(async () => {
    const axe = (
      globalThis as unknown as { axe: { run: () => Promise<{ violations: AxeResult[] }> } }
    ).axe;
    const result = await axe.run();
    return result.violations;
  });
  expect(
    violations,
    violations
      .map(
        (v) => `${v.id}: ${v.description} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
      )
      .join("\n"),
  ).toEqual([]);
}
