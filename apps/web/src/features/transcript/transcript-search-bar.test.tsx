import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import { Transcript } from "./transcript.js";
import { TranscriptSearchBar } from "./transcript-search-bar.js";

afterEach(cleanup);

function row(
  overrides: Record<string, unknown> & { kind: string; id: string },
): timeline.TranscriptEntry {
  return {
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    ...overrides,
  } as timeline.TranscriptEntry;
}

function messageEntries(): timeline.TranscriptEntry[] {
  return [
    row({ kind: "user-message", id: "u1", seqStart: 1, seqEnd: 1, text: "Hello Pi" }),
    row({
      kind: "assistant-message",
      id: "a1",
      seqStart: 2,
      seqEnd: 2,
      text: "Hi there, needle here",
      corrected: false,
    }),
    row({ kind: "thinking", id: "t1", seqStart: 3, seqEnd: 3, text: "a second needle" }),
  ];
}

describe("TranscriptSearchBar", () => {
  it("renders the field, the count, and both navigation buttons", () => {
    render(
      <TranscriptSearchBar
        query="needle"
        onQueryChange={() => {}}
        currentIndex={0}
        totalCount={2}
        onNext={() => {}}
        onPrevious={() => {}}
        testId="search"
      />,
    );
    expect(screen.getByTestId("search-input")).toBeTruthy();
    expect(screen.getByTestId("search-count").textContent).toBe("1 of 2");
    expect(screen.getByTestId("search-previous")).toBeTruthy();
    expect(screen.getByTestId("search-next")).toBeTruthy();
  });

  it("shows no count before a query is entered", () => {
    render(
      <TranscriptSearchBar
        query=""
        onQueryChange={() => {}}
        currentIndex={-1}
        totalCount={0}
        onNext={() => {}}
        onPrevious={() => {}}
        testId="search"
      />,
    );
    expect(screen.queryByTestId("search-count")).toBeNull();
  });

  it("disables navigation with no matches rather than hiding it", () => {
    render(
      <TranscriptSearchBar
        query="missing"
        onQueryChange={() => {}}
        currentIndex={-1}
        totalCount={0}
        onNext={() => {}}
        onPrevious={() => {}}
        testId="search"
      />,
    );
    expect(screen.getByTestId("search-count").textContent).toBe("No matches");
    expect(screen.getByTestId("search-previous").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("search-next").hasAttribute("disabled")).toBe(true);
  });
});

describe("Transcript find in transcript", () => {
  it("renders no search bar for an empty transcript", () => {
    render(<Transcript entries={[]} testId="transcript" />);
    expect(screen.queryByTestId("transcript-search-input")).toBeNull();
  });

  it("counts matches as the query narrows and names the active match", async () => {
    const user = userEvent.setup();
    render(<Transcript entries={messageEntries()} testId="transcript" />);
    await user.type(screen.getByTestId("transcript-search-input"), "needle");
    expect(screen.getByTestId("transcript-search-count").textContent).toBe("1 of 2");
  });

  it("reports no matches for a query with no hits", async () => {
    const user = userEvent.setup();
    render(<Transcript entries={messageEntries()} testId="transcript" />);
    await user.type(screen.getByTestId("transcript-search-input"), "xyzzy");
    expect(screen.getByTestId("transcript-search-count").textContent).toBe("No matches");
  });

  it("moves the active highlight through previous/next with wrap", async () => {
    const user = userEvent.setup();
    const { container } = render(<Transcript entries={messageEntries()} testId="transcript" />);
    await user.type(screen.getByTestId("transcript-search-input"), "needle");

    const activeText = () => container.querySelector("[data-search-active]")?.textContent ?? "";
    expect(activeText()).toContain("Hi there");

    await user.click(screen.getByTestId("transcript-search-next"));
    expect(screen.getByTestId("transcript-search-count").textContent).toBe("2 of 2");
    expect(activeText()).toContain("a second needle");

    // Wraps past the last match back to the first.
    await user.click(screen.getByTestId("transcript-search-next"));
    expect(screen.getByTestId("transcript-search-count").textContent).toBe("1 of 2");
    expect(activeText()).toContain("Hi there");

    await user.click(screen.getByTestId("transcript-search-previous"));
    expect(screen.getByTestId("transcript-search-count").textContent).toBe("2 of 2");
    expect(activeText()).toContain("a second needle");
  });

  it("scrolls to the active match", async () => {
    const user = userEvent.setup();
    // 20 rows at the ~96px estimate comfortably exceeds the mocked
    // viewport, so reaching the last row requires a real scroll — a
    // three-row transcript fits entirely and would prove nothing.
    const entries: timeline.TranscriptEntry[] = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0
        ? row({
            kind: "user-message",
            id: `u${index}`,
            seqStart: index + 1,
            seqEnd: index + 1,
            text: `filler ${index}`,
          })
        : row({
            kind: "assistant-message",
            id: `a${index}`,
            seqStart: index + 1,
            seqEnd: index + 1,
            text: index === 19 ? "the needle at the end" : `filler ${index}`,
            corrected: false,
          }),
    );
    // `scrollToIndex`'s `{ align: "center" }` path reads the scroll
    // element's *real* `scrollHeight`/`clientHeight` (see
    // `transcript.test.tsx`'s `withMockedContainerGeometry`, copied here) —
    // `jsdom` never lays either out, so without this every max-offset
    // computation is `0` and no scroll can be observed at all.
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 1_920,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 480,
    });
    try {
      const { container } = render(<Transcript entries={entries} testId="transcript" />);
      const scrollContainer = container.querySelector<HTMLElement>('[data-testid="transcript"]');
      if (!scrollContainer) {
        throw new Error("expected the transcript scroll container to be present");
      }
      // Park at the top: follow-tail already scrolled to the bottom on mount,
      // so only a search-driven scroll can move this again.
      scrollContainer.scrollTop = 0;
      await user.type(screen.getByTestId("transcript-search-input"), "needle");
      expect(scrollContainer.scrollTop).toBeGreaterThan(0);
    } finally {
      if (scrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
      }
      if (clientHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
      }
    }
  });

  it("marks every matched row, with the active one distinct", async () => {
    const user = userEvent.setup();
    const { container } = render(<Transcript entries={messageEntries()} testId="transcript" />);
    await user.type(screen.getByTestId("transcript-search-input"), "needle");
    const matched = container.querySelectorAll("[data-search-match]");
    expect(matched.length).toBe(2);
    const active = container.querySelectorAll("[data-search-active]");
    expect(active.length).toBe(1);
    expect(active[0]?.textContent).toContain("Hi there");
  });

  it("restarts at the first match for a new query", async () => {
    const user = userEvent.setup();
    render(<Transcript entries={messageEntries()} testId="transcript" />);
    const input = screen.getByTestId("transcript-search-input");
    await user.type(input, "needle");
    await user.click(screen.getByTestId("transcript-search-next"));
    expect(screen.getByTestId("transcript-search-count").textContent).toBe("2 of 2");
    await user.clear(input);
    await user.type(input, "hello");
    expect(screen.getByTestId("transcript-search-count").textContent).toBe("1 of 1");
  });

  it("exposes the search region to assistive tech", async () => {
    const user = userEvent.setup();
    render(<Transcript entries={messageEntries()} testId="transcript" />);
    expect(screen.getByRole("searchbox", { name: "Search transcript" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous match" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next match" })).toBeTruthy();
    await user.type(screen.getByTestId("transcript-search-input"), "needle");
    const bar = screen.getByTestId("transcript-search");
    expect(within(bar).getByRole("status").textContent).toBe("1 of 2");
  });
});

/**
 * The search bar's own styling contract (same shape as the T308
 * timestamp-style suite in `transcript.test.tsx`): every class it and the
 * match highlight carry must be declared, and declared from design
 * tokens — a class with no rule renders as unstyled text, invisible to
 * every DOM assertion above.
 */
describe("Transcript search styling", () => {
  function cssWithoutComments(): string {
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), "transcript.css");
    return readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  }

  function ruleBody(selector: string): string {
    const css = cssWithoutComments();
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} is not declared in transcript.css`).toBeGreaterThanOrEqual(0);
    const close = css.indexOf("}", at);
    expect(close, `${selector} has no closing brace`).toBeGreaterThan(at);
    return css.slice(at, close);
  }

  it("declares the search bar, its count, and both row highlight classes", () => {
    expect(ruleBody(".pc-transcript-search")).toContain(".pc-transcript-search");
    expect(ruleBody(".pc-transcript-search__count")).toContain(".pc-transcript-search__count");
    expect(ruleBody(".pc-transcript__row--search-match")).toContain(
      ".pc-transcript__row--search-match",
    );
    expect(ruleBody(".pc-transcript__row--search-active")).toContain(
      ".pc-transcript__row--search-active",
    );
  });

  it("takes the bar and highlight treatment from design tokens, never a raw value", () => {
    const bar = ruleBody(".pc-transcript-search");
    expect(bar).toMatch(/gap:\s*var\(--spacing-2\)/);
    expect(bar).toMatch(/background:\s*var\(--color-canvas\)/);
    expect(bar).toMatch(/border-bottom:\s*1px solid var\(--color-line\)/);
    const active = ruleBody(".pc-transcript__row--search-active");
    expect(active).toMatch(/outline:\s*2px solid var\(--color-accent\)/);
    expect(active).toMatch(/background:\s*var\(--color-accent-tint\)/);
    expect(active).toMatch(/border-radius:\s*var\(--radius-control\)/);
    for (const rule of [bar, ruleBody(".pc-transcript-search__count"), active]) {
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(rule).not.toMatch(/rgba?\(/);
    }
  });
});
