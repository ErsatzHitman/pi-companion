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

/** Injects axe-core (once per page) and asserts zero violations for the current document. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
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
