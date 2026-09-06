import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { MAX_DIFF_OUTPUT_LINES } from "./file-diff.js";
import { FileDiffView } from "./file-diff-view.js";

afterEach(cleanup);

/**
 * `file-diff.ts` is dynamically imported inside `FileDiffView`'s mount
 * effect (the module doc comment explains why: it's this task's "diff
 * chunk"). It's a small, local, DOM-free module — nothing like
 * `file-code-editor.test.tsx`'s real `@picompanion/highlight` import
 * chain — but every dynamic-import wait in this suite still uses an
 * explicit, generous ceiling rather than `waitFor`'s 1s default, per
 * the repository's lazy-import flake guidance.
 */
const LAZY_IMPORT_WAIT = { timeout: 15_000 } as const;

describe("FileDiffView (T30B6)", () => {
  it("renders added and removed lines for a changed file", async () => {
    render(
      <FileDiffView
        path="src/greeting.ts"
        oldText={"hello\nworld"}
        newText={"hello\nWORLD\n!"}
        testId="diff"
      />,
    );

    await waitFor(() => expect(screen.getByTestId("diff-body")).toBeTruthy(), LAZY_IMPORT_WAIT);

    const removed = screen.getByText("world", {
      selector: ".pc-file-diff__line--remove .pc-file-diff__text",
    });
    const added = screen.getByText("WORLD", {
      selector: ".pc-file-diff__line--add .pc-file-diff__text",
    });
    expect(removed).toBeTruthy();
    expect(added).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
  }, 20_000);

  it("shows a loading state before the diff chunk resolves", () => {
    render(<FileDiffView path="src/greeting.ts" oldText="a" newText="b" testId="diff" />);
    expect(screen.getByTestId("diff-loading")).toBeTruthy();
  });

  it("reports no changes for identical text without treating it as an error", async () => {
    render(
      <FileDiffView path="src/same.ts" oldText="same\ntext" newText="same\ntext" testId="diff" />,
    );

    await waitFor(() => expect(screen.getByTestId("diff-empty")).toBeTruthy(), LAZY_IMPORT_WAIT);
    expect(screen.queryByTestId("diff-body")).toBeNull();
  }, 20_000);

  it("recomputes when oldText/newText change", async () => {
    const { rerender } = render(
      <FileDiffView path="src/greeting.ts" oldText="a" newText="a" testId="diff" />,
    );
    await waitFor(() => expect(screen.getByTestId("diff-empty")).toBeTruthy(), LAZY_IMPORT_WAIT);

    rerender(<FileDiffView path="src/greeting.ts" oldText="a" newText="b" testId="diff" />);
    await waitFor(() => expect(screen.getByTestId("diff-body")).toBeTruthy(), LAZY_IMPORT_WAIT);
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
  }, 20_000);

  it("shows a visible truncation note, rather than dropping the diff, for a very large change", async () => {
    const count = 1050;
    const oldText = Array.from({ length: count }, (_, i) => `old-line-${i}`).join("\n");
    const newText = Array.from({ length: count }, (_, i) => `new-line-${i}`).join("\n");

    render(<FileDiffView path="src/big.ts" oldText={oldText} newText={newText} testId="diff" />);

    await waitFor(() => expect(screen.getByTestId("diff-body")).toBeTruthy(), LAZY_IMPORT_WAIT);
    expect(screen.getByTestId("diff-truncated")).toBeTruthy();
    const renderedLines = document.querySelectorAll(".pc-file-diff__line");
    expect(renderedLines.length).toBeLessThanOrEqual(MAX_DIFF_OUTPUT_LINES);
    expect(renderedLines.length).toBeGreaterThan(0);
  }, 20_000);

  it("collapses a large unchanged span between two chunks into a visible skipped-lines count", async () => {
    const gap = Array.from({ length: 50 }, (_, i) => `unchanged-${i}`);
    const oldText = ["FIRST", ...gap, "LAST"].join("\n");
    const newText = ["first", ...gap, "last"].join("\n");

    render(<FileDiffView path="src/gap.ts" oldText={oldText} newText={newText} testId="diff" />);

    await waitFor(() => expect(screen.getByTestId("diff-body")).toBeTruthy(), LAZY_IMPORT_WAIT);
    const skipNotes = document.querySelectorAll(".pc-file-diff__skip");
    expect(skipNotes.length).toBeGreaterThan(0);
    expect(skipNotes[0]?.textContent).toMatch(/unchanged line.* not shown/);
  }, 20_000);

  it("marks every changed line's kind in text, not colour alone", async () => {
    render(<FileDiffView path="src/greeting.ts" oldText="a" newText="b" testId="diff" />);
    await waitFor(() => expect(screen.getByTestId("diff-body")).toBeTruthy(), LAZY_IMPORT_WAIT);

    expect(screen.getByText("(added line)")).toBeTruthy();
    expect(screen.getByText("(removed line)")).toBeTruthy();
  }, 20_000);

  it("has no axe violations while showing a diff", async () => {
    const { container } = render(
      <FileDiffView path="src/greeting.ts" oldText="a\nb" newText="a\nB" testId="diff" />,
    );
    await waitFor(() => expect(screen.getByTestId("diff-body")).toBeTruthy(), LAZY_IMPORT_WAIT);

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  it("has no axe violations while empty (identical text)", async () => {
    const { container } = render(
      <FileDiffView path="src/same.ts" oldText="same" newText="same" testId="diff" />,
    );
    await waitFor(() => expect(screen.getByTestId("diff-empty")).toBeTruthy(), LAZY_IMPORT_WAIT);

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
