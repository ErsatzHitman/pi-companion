import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { testing } from "@picompanion/frontend-core";

import { RecipeLab } from "./recipe-lab.js";

/**
 * T25B recipe-lab test (plan.md §10.4, §10.5). Renders the whole lab from
 * the shared `testing.recipeLabManifest` fixture list and runs an axe
 * accessibility scan across the page, per plan.md §10.5's "Web runs axe
 * checks" — mirrors `component-lab.test.tsx`.
 */
describe("RecipeLab", () => {
  // Explicit budget for the same reason as ComponentLab: rendering the whole
  // lab is slow enough to brush vitest's 5s default under a full-suite run.
  it("renders every §10.4 recipe listed in the shared manifest", () => {
    render(<RecipeLab />);

    for (const name of testing.recipeLabManifest) {
      expect(screen.getByRole("heading", { name, level: 2 })).toBeTruthy();
    }
  }, 20_000);

  it("has no axe violations", async () => {
    const { container } = render(<RecipeLab />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);
});
