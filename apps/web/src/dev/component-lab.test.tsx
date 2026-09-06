import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { testing } from "@picompanion/frontend-core";

import { ComponentLab } from "./component-lab.js";

/**
 * T25A component-lab test (plan.md §10.3, §10.5). Renders the whole lab
 * from the shared `testing.primitiveLabManifest` fixture list and runs an
 * axe accessibility scan across the page, per plan.md §10.5's "Web runs
 * axe checks."
 */
describe("ComponentLab", () => {
  // Rendering all 26 primitives takes ~3-4s, which sits too close to vitest's
  // 5s default; it passed when run alone and timed out under a full-suite run.
  // The axe case below already carries an explicit budget for the same reason.
  it("renders every §10.3 primitive listed in the shared manifest", () => {
    render(<ComponentLab />);

    for (const name of testing.primitiveLabManifest) {
      expect(screen.getByRole("heading", { name, level: 2 })).toBeTruthy();
    }
  }, 20_000);

  it("has no axe violations", async () => {
    const { container } = render(<ComponentLab />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);
});
