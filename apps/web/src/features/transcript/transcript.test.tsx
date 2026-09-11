import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { breakpoints } from "@picompanion/design-tokens";
import { axe } from "jest-axe";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import { buildEditFromHereTargets } from "./edit-from-here-target.js";
import { Transcript } from "./transcript.js";

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

describe("Transcript", () => {
  it("shows an empty state when there are no messages yet", () => {
    render(<Transcript entries={[]} testId="transcript" />);
    expect(screen.getByText("No messages yet")).toBeTruthy();
  });

  it("renders user, assistant, thinking, and tool-call entries in order, and skips entry kinds this task does not own", () => {
    const entries: timeline.TranscriptEntry[] = [
      row({ kind: "user-message", id: "u1", seqStart: 1, seqEnd: 1, text: "Hello Pi" }),
      row({
        kind: "thinking",
        id: "t1",
        seqStart: 2,
        seqEnd: 2,
        text: "considering…",
      }),
      row({
        kind: "tool-call",
        id: "tc1",
        seqStart: 3,
        seqEnd: 3,
        tool: {
          family: "plain_text",
          callId: "call-1",
          toolName: "note",
          status: "completed",
          displayName: "Note",
          updateCount: 1,
          text: "a plain-text tool result",
        },
      }),
      row({
        kind: "todo",
        id: "todo1",
        seqStart: 4,
        seqEnd: 4,
        items: [{ text: "still out of scope", completed: false }],
      }),
      row({
        kind: "assistant-message",
        id: "a1",
        seqStart: 5,
        seqEnd: 5,
        text: "Hi there",
        corrected: false,
      }),
    ];
    render(<Transcript entries={entries} testId="transcript" />);
    const messageRows = screen.getAllByRole("group");
    expect(messageRows).toHaveLength(2);
    expect(messageRows[0]?.textContent).toContain("Hello Pi");
    expect(messageRows[1]?.textContent).toContain("Hi there");

    // The thinking entry renders (T28A3) and the tool-call entry renders
    // (T28A4) between the two messages; the `todo` entry (still out of
    // this task's scope) is silently skipped.
    const thinkingTrigger = screen.getByRole("button", { name: /considering/ });
    expect(thinkingTrigger).toBeTruthy();
    expect(screen.getByText("a plain-text tool result")).toBeTruthy();
    // T28A6 virtualizes the row list: rows are no longer direct children
    // of the `role="log"` container — each sits inside its own
    // `[data-index]` virtual-item wrapper — so DOM order is asserted
    // through those wrappers (one per row, unambiguous, unlike
    // `[data-testid^="transcript-row-"]`, which also matches a tool-call
    // row's own nested `-status` sub-element) rather than
    // `container.children`. Same guarantee (chronological DOM order),
    // adapted to the new structure.
    const container = screen.getByTestId("transcript");
    const order = Array.from(container.querySelectorAll<HTMLElement>("[data-index]")).map(
      (row) => row.textContent ?? "",
    );
    expect(order).toHaveLength(4);
    expect(order[0]).toContain("Hello Pi");
    expect(order[1]).toContain("considering");
    expect(order[2]).toContain("a plain-text tool result");
    expect(order[3]).toContain("Hi there");
    expect(screen.queryByText(/still out of scope/)).toBeNull();
  });

  it("marks only the streaming entry as still responding", () => {
    const entries: timeline.TranscriptEntry[] = [
      row({ kind: "user-message", id: "u1", seqStart: 1, seqEnd: 1, text: "Hello Pi" }),
      row({
        kind: "assistant-message",
        id: "a1",
        seqStart: 2,
        seqEnd: 2,
        text: "Hi ther",
        corrected: false,
      }),
    ];
    render(<Transcript entries={entries} streamingEntryId="a1" testId="transcript" />);
    expect(screen.getByText("Pi is still responding")).toBeTruthy();
    expect(screen.getAllByText("Pi is still responding")).toHaveLength(1);
  });

  it("updates streaming text incrementally without re-rendering settled rows", () => {
    const initial: timeline.TranscriptEntry[] = [
      row({ kind: "user-message", id: "u1", seqStart: 1, seqEnd: 1, text: "Hello Pi" }),
      row({
        kind: "assistant-message",
        id: "a1",
        seqStart: 2,
        seqEnd: 2,
        text: "Hel",
        corrected: false,
      }),
    ];
    const { rerender, container } = render(
      <Transcript entries={initial} streamingEntryId="a1" testId="transcript" />,
    );
    const settledRowCounter = () =>
      container
        .querySelector('[data-testid="transcript-row-u1"]')
        ?.parentElement?.getAttribute("data-render-count");
    const streamingRowCounter = () =>
      container
        .querySelector('[data-testid="transcript-row-a1"]')
        ?.parentElement?.getAttribute("data-render-count");

    expect(settledRowCounter()).toBe("1");
    expect(streamingRowCounter()).toBe("1");

    const updated: timeline.TranscriptEntry[] = [
      initial[0] as timeline.TranscriptEntry,
      {
        ...(initial[1] as Extract<timeline.TranscriptEntry, { kind: "assistant-message" }>),
        text: "Hello",
      },
    ];
    rerender(<Transcript entries={updated} streamingEntryId="a1" testId="transcript" />);

    expect(settledRowCounter()).toBe("1");
    expect(streamingRowCounter()).toBe("2");
    expect(container.querySelector('[data-testid="transcript-row-a1"]')?.textContent).toContain(
      "Hello",
    );
  });

  it("marks only the streaming thinking entry as still thinking", () => {
    const entries: timeline.TranscriptEntry[] = [
      row({ kind: "thinking", id: "t1", seqStart: 1, seqEnd: 1, text: "settled reasoning" }),
      row({ kind: "thinking", id: "t2", seqStart: 2, seqEnd: 2, text: "live reasoning" }),
    ];
    render(<Transcript entries={entries} streamingEntryId="t2" testId="transcript" />);
    expect(screen.getByText("Still thinking")).toBeTruthy();
    expect(screen.getAllByText("Still thinking")).toHaveLength(1);
  });

  it("has no axe violations", async () => {
    const entries: timeline.TranscriptEntry[] = [
      row({ kind: "user-message", id: "u1", seqStart: 1, seqEnd: 1, text: "Hello Pi" }),
      row({
        kind: "assistant-message",
        id: "a1",
        seqStart: 2,
        seqEnd: 2,
        text: "Hi there",
        corrected: false,
      }),
    ];
    const { container } = render(
      <Transcript entries={entries} streamingEntryId="a1" testId="transcript" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  it("has no axe violations with a thinking entry present", async () => {
    const entries: timeline.TranscriptEntry[] = [
      row({ kind: "user-message", id: "u1", seqStart: 1, seqEnd: 1, text: "Hello Pi" }),
      row({ kind: "thinking", id: "t1", seqStart: 2, seqEnd: 2, text: "considering options" }),
    ];
    const { container } = render(
      <Transcript entries={entries} streamingEntryId="t1" testId="transcript" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  it("threads resolveImageSrc down to each message row's images (T52A3)", () => {
    const entries: timeline.TranscriptEntry[] = [
      row({
        kind: "user-message",
        id: "u1",
        seqStart: 1,
        seqEnd: 1,
        text: "Look at this",
        images: [{ mimeType: "image/png", path: "/tmp/paseo-attachments-x/a.png", bytes: 1024 }],
      }),
    ];
    render(
      <Transcript
        entries={entries}
        resolveImageSrc={() => "https://daemon.example/a.png"}
        testId="transcript"
      />,
    );
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("https://daemon.example/a.png");
  });

  it("has no axe violations for a message carrying both a resolvable and an unresolved image", async () => {
    const entries: timeline.TranscriptEntry[] = [
      row({
        kind: "user-message",
        id: "u1",
        seqStart: 1,
        seqEnd: 1,
        text: "Two images",
        images: [
          { mimeType: "image/png", path: "/tmp/paseo-attachments-x/a.png", bytes: 1024 },
          { mimeType: "image/jpeg", path: "/tmp/paseo-attachments-x/b.jpg", bytes: 4096 },
        ],
      }),
    ];
    const { container } = render(
      <Transcript
        entries={entries}
        resolveImageSrc={(image) =>
          image.mimeType === "image/png" ? "https://daemon.example/a.png" : undefined
        }
        testId="transcript"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

/**
 * T28A7 (plan.md §11.1 "compaction and summarization retry"; §7.4).
 * `compaction-row.tsx` owns the marker's own rendering/wording/axe
 * coverage in isolation; these integration tests only prove `Transcript`
 * actually reaches it from a real `entries` array, in chronological
 * order alongside every other row kind, and that a compaction marker is
 * visibly distinct from a chat message rather than folded into one.
 */
describe("Transcript compaction markers (T28A7)", () => {
  it("renders a compaction marker between messages, in chronological order, as a distinct status region", () => {
    const entries: timeline.TranscriptEntry[] = [
      row({
        kind: "user-message",
        id: "u1",
        seqStart: 1,
        seqEnd: 1,
        text: "Summarize what we discussed",
      }),
      row({
        kind: "compaction",
        id: "c1",
        seqStart: 2,
        seqEnd: 2,
        status: "completed",
        trigger: "auto",
        preTokens: 50_000,
      }),
      row({
        kind: "assistant-message",
        id: "a1",
        seqStart: 3,
        seqEnd: 3,
        text: "Here is the summary",
        corrected: false,
      }),
    ];
    render(<Transcript entries={entries} testId="transcript" />);

    const container = screen.getByTestId("transcript");
    const order = Array.from(container.querySelectorAll<HTMLElement>("[data-index]")).map(
      (item) => item.textContent ?? "",
    );
    expect(order).toHaveLength(3);
    expect(order[0]).toContain("Summarize what we discussed");
    expect(order[1]).toContain("Automatic compaction completed");
    expect(order[2]).toContain("Here is the summary");

    // Distinct from the two message rows: a `role="status"` marker, not
    // one of the `role="group"` speaker-attributed bubbles.
    expect(screen.getAllByRole("group")).toHaveLength(2);
    const marker = screen.getByTestId("transcript-row-c1");
    expect(marker.getAttribute("role")).toBe("status");
  });

  it("renders an in-progress compaction distinctly from a completed one", () => {
    const entries: timeline.TranscriptEntry[] = [
      row({
        kind: "compaction",
        id: "c1",
        seqStart: 1,
        seqEnd: 1,
        status: "loading",
        trigger: "manual",
      }),
    ];
    render(<Transcript entries={entries} testId="transcript" />);
    expect(screen.getByText(/Manual compaction in progress/)).toBeTruthy();
  });

  it("has no axe violations with a compaction marker present", async () => {
    const entries: timeline.TranscriptEntry[] = [
      row({ kind: "user-message", id: "u1", seqStart: 1, seqEnd: 1, text: "Hello Pi" }),
      row({
        kind: "compaction",
        id: "c1",
        seqStart: 2,
        seqEnd: 2,
        status: "completed",
        trigger: "auto",
      }),
    ];
    const { container } = render(<Transcript entries={entries} testId="transcript" />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

/**
 * T28A7 (plan.md §8.3 "wide layout", §10.2 "compact and wide
 * breakpoints"). `shell.test.tsx` proves the same thing for the shell's
 * macro three-region layout; this proves the transcript's own container
 * styling is pinned to the same `@picompanion/design-tokens` breakpoint
 * rather than a second, independently drifting literal.
 */
describe("Transcript compact layout (T28A7)", () => {
  it("declares a wide-layout media query pinned to the design-tokens wide breakpoint", () => {
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), "transcript.css");
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain(`@media (min-width: ${breakpoints.wide}px)`);
  });

  it("uses a tighter compact-default padding than the wide-only override, so the media query is a real layout change, not an empty rule", () => {
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), "transcript.css");
    const css = readFileSync(cssPath, "utf8");
    const [beforeMediaQuery, afterMediaQueryStart] = css.split(
      `@media (min-width: ${breakpoints.wide}px)`,
    );
    expect(beforeMediaQuery).toBeDefined();
    expect(afterMediaQueryStart).toBeDefined();
    // The compact (mobile-first) default declares `.pc-transcript`'s
    // padding once, before the media query, using the tighter token.
    expect(beforeMediaQuery).toMatch(
      /\.pc-transcript\s*{[^}]*padding:\s*var\(--spacing-3\)\s+var\(--spacing-2\)/,
    );
    // The wide-only override, inside the media query, restores the
    // roomier token — a real value change, not a no-op re-declaration.
    expect(afterMediaQueryStart).toMatch(/\.pc-transcript\s*{[^}]*padding:\s*var\(--spacing-4\)/);
  });

  it("renders every included row kind together without a crash when the transcript's own scroll container measures a compact (sub-wide) height", () => {
    // Virtualization windows on measured *height*, not width (a vertical
    // list) — `transcript.css`'s compact-layout doc comment is explicit
    // that no row recipe forces a pixel width, so there is nothing width
    // based for this component's own logic to get wrong at a compact
    // viewport. What a compact viewport *does* plausibly shrink is
    // available height (a phone browser's chrome, plus the shell's
    // stacked session/extension rails above and below the centre column
    // at this same breakpoint, `shell.css`). This proves the mixed row
    // list T28A7 adds a marker to (message, thinking, compaction) still
    // renders correctly — mounted, in order, with correct text — under
    // that shrunk geometry, not just at the generously-sized default the
    // rest of this file's tests use.
    const entries: timeline.TranscriptEntry[] = [
      row({ kind: "user-message", id: "u1", seqStart: 1, seqEnd: 1, text: "Hello Pi" }),
      row({ kind: "thinking", id: "t1", seqStart: 2, seqEnd: 2, text: "considering" }),
      row({
        kind: "compaction",
        id: "c1",
        seqStart: 3,
        seqEnd: 3,
        status: "completed",
        trigger: "auto",
      }),
      row({
        kind: "assistant-message",
        id: "a1",
        seqStart: 4,
        seqEnd: 4,
        text: "Hi there",
        corrected: false,
      }),
    ];
    const { container } = withMockedContainerGeometry(
      { scrollHeight: 640, clientHeight: 320 },
      () => render(<Transcript entries={entries} testId="transcript" />),
    );
    const rowEls = container.querySelectorAll<HTMLElement>("[data-index]");
    expect(rowEls).toHaveLength(4);
    const texts = Array.from(rowEls).map((el) => el.textContent ?? "");
    expect(texts[0]).toContain("Hello Pi");
    expect(texts[1]).toContain("considering");
    expect(texts[2]).toContain("Automatic compaction completed");
    expect(texts[3]).toContain("Hi there");
  });
});

/**
 * `jsdom` never computes real layout, so `HTMLElement`'s scroll metrics
 * (`scrollTop`/`scrollHeight`/`clientHeight`) all read `0` unless a test
 * sets them explicitly. Scoped to one element instance (not the
 * prototype), so it never leaks into another test.
 */
function mockScrollMetrics(
  element: HTMLElement,
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
): void {
  let scrollTop = metrics.scrollTop;
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  });
}

/**
 * `Virtualizer.scrollToIndex`'s `{ align: "end" }` path for the very
 * last item reads the scroll element's *real* `scrollHeight`/`clientHeight`
 * (to account for borders/padding the JS-computed measurements do not
 * capture — see `getMaxScrollOffset` in `@tanstack/virtual-core`), not
 * the virtualizer's own computed total size. `jsdom` never lays out the
 * sizer div's inline `height` style, so those always read `0` unless a
 * test supplies them — and unlike `scrollTop`, they have to be in place
 * *before* mount, since `Transcript`'s follow-tail effect runs
 * synchronously during the same commit. Scoped to `HTMLElement.prototype`
 * only for the duration of `fn`, restored immediately after.
 */
function withMockedContainerGeometry<T>(
  geometry: { scrollHeight: number; clientHeight: number },
  fn: () => T,
): T {
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
    get: () => geometry.scrollHeight,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => geometry.clientHeight,
  });
  try {
    return fn();
  } finally {
    if (scrollHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
    }
    if (clientHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
    }
  }
}

function manyMessageEntries(count: number): timeline.TranscriptEntry[] {
  const entries: timeline.TranscriptEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    entries.push(
      row({
        kind: index % 2 === 0 ? "user-message" : "assistant-message",
        id: `m${index}`,
        seqStart: index + 1,
        seqEnd: index + 1,
        text: `message ${index}`,
        ...(index % 2 === 0 ? {} : { corrected: false }),
      }),
    );
  }
  return entries;
}

/**
 * T28A6 (plan.md §14.5 "transcript: 10,000 timeline items without
 * rendering more than a bounded window") and its follow-tail/scroll
 * acceptance criteria.
 */
describe("Transcript virtualization (T28A6)", () => {
  it("renders a 10,000-item transcript within a bounded DOM window", () => {
    const entries = manyMessageEntries(10_000);
    const { container } = render(<Transcript entries={entries} testId="transcript" />);

    const mountedRows = container.querySelectorAll("[data-index]");
    // Far below 10,000 — the exact count depends on the viewport-size
    // fallback and overscan, not on total entry count, which is the
    // whole point: it must never scale with the transcript's length.
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThan(200);

    // The sizer still reserves the full scrollable extent so native
    // scrollbar affordances stay correct even though most rows are
    // unmounted.
    const sizer = container.querySelector<HTMLElement>(".pc-transcript__sizer");
    expect(sizer).not.toBeNull();
    expect(sizer?.style.height).not.toBe("");
    expect(Number.parseFloat(sizer?.style.height ?? "0")).toBeGreaterThan(100_000);
  }, 20_000);

  it("auto-follows the tail: the newest row is scrolled into view without an explicit jump", () => {
    // 20 rows at the ~96px estimate comfortably exceeds the mocked
    // viewport, so a real scroll adjustment is required to reach the
    // last row.
    const entries = manyMessageEntries(20);
    const { container } = withMockedContainerGeometry(
      { scrollHeight: 1_920, clientHeight: 480 },
      () => render(<Transcript entries={entries} testId="transcript" />),
    );
    const scrollContainer = container.querySelector<HTMLElement>('[data-testid="transcript"]');
    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer?.scrollTop ?? 0).toBeGreaterThan(0);
  });

  it("does not yank the reader's scroll position when a new row streams in after they scroll away from the tail", () => {
    const entries = manyMessageEntries(20);
    const { container, rerender } = render(<Transcript entries={entries} testId="transcript" />);
    const scrollContainer = container.querySelector<HTMLElement>('[data-testid="transcript"]');
    if (!scrollContainer) {
      throw new Error("expected the transcript scroll container to be present");
    }

    // Simulate the reader scrolling up into history, well clear of the
    // `FOLLOW_TAIL_THRESHOLD_PX` band near the bottom. `Transcript`
    // re-reads this geometry fresh on the next anchor attempt rather than
    // through a `scroll` listener (see the component's doc comment), so
    // no event needs to be dispatched here — only the resulting DOM state
    // matters.
    mockScrollMetrics(scrollContainer, { scrollTop: 100, scrollHeight: 5_000, clientHeight: 400 });

    const scrollTopAfterUserScroll = scrollContainer.scrollTop;
    expect(scrollTopAfterUserScroll).toBe(100);

    // A new row streams in — the reader's position must not move.
    rerender(<Transcript entries={[...entries, ...manyMessageEntries(1)]} testId="transcript" />);

    expect(scrollContainer.scrollTop).toBe(scrollTopAfterUserScroll);
  });

  it("resumes following the tail once the reader scrolls back near the bottom", () => {
    const entries = manyMessageEntries(20);
    const { container, rerender } = render(<Transcript entries={entries} testId="transcript" />);
    const scrollContainer = container.querySelector<HTMLElement>('[data-testid="transcript"]');
    if (!scrollContainer) {
      throw new Error("expected the transcript scroll container to be present");
    }

    mockScrollMetrics(scrollContainer, { scrollTop: 100, scrollHeight: 5_000, clientHeight: 400 });
    rerender(<Transcript entries={[...entries, ...manyMessageEntries(1)]} testId="transcript" />);
    expect(scrollContainer.scrollTop).toBe(100);

    // Scrolling back within the follow-tail threshold of the bottom
    // resumes auto-follow for the next appended row.
    mockScrollMetrics(scrollContainer, {
      scrollTop: 4_950,
      scrollHeight: 5_000,
      clientHeight: 400,
    });
    rerender(<Transcript entries={[...entries, ...manyMessageEntries(2)]} testId="transcript" />);

    expect(scrollContainer.scrollTop).not.toBe(4_950);
  });
});

describe("Transcript edit-from-here wiring (T105)", () => {
  const entries: timeline.TranscriptEntry[] = [
    row({ kind: "user-message", id: "u1", seqStart: 1, seqEnd: 1, text: "please add a test" }),
    row({
      kind: "assistant-message",
      id: "a1",
      seqStart: 2,
      seqEnd: 2,
      text: "sure, here's a test",
      corrected: false,
    }),
    row({ kind: "user-message", id: "u2", seqStart: 3, seqEnd: 3, text: "actually use vitest" }),
  ];

  it("renders no edit-from-here affordance on any row when neither prop is supplied", () => {
    render(<Transcript entries={entries} testId="transcript" />);
    expect(screen.queryAllByRole("button", { name: "Edit from here" })).toHaveLength(0);
  });

  it("wires onEditFromHere through to the correct message row, disabled for the first message and enabled for the second", async () => {
    const user = userEvent.setup();
    const onEditFromHere = vi.fn();
    render(
      <Transcript
        entries={entries}
        editFromHereTargets={buildEditFromHereTargets(entries)}
        onEditFromHere={onEditFromHere}
        testId="transcript"
      />,
    );

    const firstButton = screen.getByTestId("transcript-row-u1-edit-from-here");
    expect(firstButton.hasAttribute("disabled")).toBe(true);

    const secondButton = screen.getByTestId("transcript-row-u2-edit-from-here");
    expect(secondButton.hasAttribute("disabled")).toBe(false);

    await user.click(secondButton);
    expect(onEditFromHere).toHaveBeenCalledTimes(1);
    expect(onEditFromHere).toHaveBeenCalledWith("u2");

    // Clicking the disabled first-message button does nothing.
    await user.click(firstButton);
    expect(onEditFromHere).toHaveBeenCalledTimes(1);
  });

  it("never renders the affordance on an assistant row", () => {
    render(
      <Transcript
        entries={entries}
        editFromHereTargets={buildEditFromHereTargets(entries)}
        onEditFromHere={vi.fn()}
        testId="transcript"
      />,
    );
    expect(screen.queryByTestId("transcript-row-a1-edit-from-here")).toBeNull();
  });
});

/**
 * T308 (extended T386) — the message timestamp's own styling and the turn
 * meta line it now lives in. `message-row.test.tsx` proves the element
 * renders with the right attributes; this proves the classes it carries
 * are actually declared, and declared from tokens.
 *
 * Worth pinning separately because a `<time className="...">` whose class
 * has no rule renders as ordinary body text: visually wrong, invisible to
 * every DOM assertion, and exactly the failure a component test cannot see.
 *
 * T386 moved the time from *below* the row (where T308 put it) into the
 * mockup's `.meta` line above it. The element, its `data-testid` suffix,
 * its `datetime`/`title` attributes and the tabular-figures treatment are
 * all unchanged; only its container and position are, which is why the
 * old "capped at the message bubble's max-width" assertion is now about
 * the meta line's own column instead.
 */
describe("Transcript message timestamp styling (T308)", () => {
  function ruleBody(selector: string): string {
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), "transcript.css");
    // Comments first — this file's own doc comments quote class names and
    // token names, and slicing to the first `}` would otherwise stop inside
    // one. The same trap T305 hit in `recipes.test.tsx`.
    const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} is not declared in transcript.css`).toBeGreaterThanOrEqual(0);
    const close = css.indexOf("}", at);
    expect(close, `${selector} has no closing brace`).toBeGreaterThan(at);
    return css.slice(at, close);
  }

  it("declares the timestamp class", () => {
    expect(ruleBody(".pc-transcript__timestamp")).toContain(".pc-transcript__timestamp");
  });

  it("takes its colour and size from design tokens, never a raw value", () => {
    const rule = ruleBody(".pc-transcript__timestamp");
    expect(rule).toMatch(/color:\s*var\(--color-ink-3\)/);
    expect(rule).toMatch(/font-size:\s*var\(--font-size-xs\)/);
    // Repository invariant: no raw colour under `apps/web`.
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rule).not.toMatch(/rgba?\(/);
  });

  it("uses tabular figures so times do not jitter down a long transcript", () => {
    expect(ruleBody(".pc-transcript__timestamp")).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("declares the meta line the time now sits in, from tokens", () => {
    const rule = ruleBody(".pc-transcript__meta");
    expect(rule).toMatch(/font-family:\s*var\(--font-family-mono\)/);
    expect(rule).toMatch(/font-size:\s*var\(--font-size-xs\)/);
    expect(rule).toMatch(/color:\s*var\(--color-ink-3\)/);
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rule).not.toMatch(/rgba?\(/);
  });

  it("uppercases the speaker label in CSS, keeping the mockup's lowercase DOM text", () => {
    const rule = ruleBody(".pc-transcript__who");
    expect(rule).toMatch(/text-transform:\s*uppercase/);
    expect(rule).toMatch(/letter-spacing:\s*0\.06em/);
    expect(rule).toMatch(/font-weight:\s*var\(--font-weight-bold\)/);
  });

  it("caps the meta line at the shared 53.5rem content column, so it cannot widen a row", () => {
    expect(ruleBody(".pc-transcript__meta")).toMatch(/max-width:\s*53\.5rem/);
    expect(ruleBody(".pc-transcript__sizer")).toMatch(/max-width:\s*53\.5rem/);
    expect(ruleBody(".pc-transcript__sizer")).toMatch(/margin:\s*0 auto/);
  });
});
