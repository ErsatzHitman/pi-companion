import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateThemeCss } from "@picompanion/design-tokens";
import type { timeline } from "@picompanion/frontend-core";

import { isCoreMessageEntry, TranscriptMessageRow } from "./message-row.js";
import type { CoreMessageEntry } from "./message-row.js";

afterEach(cleanup);

function userEntry(overrides: Record<string, unknown> = {}): CoreMessageEntry {
  return {
    kind: "user-message",
    id: "row-1",
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    text: "Hi Pi",
    ...overrides,
  } as CoreMessageEntry;
}

function assistantEntry(overrides: Record<string, unknown> = {}): CoreMessageEntry {
  return {
    kind: "assistant-message",
    id: "row-2",
    epoch: "epoch-1",
    seqStart: 2,
    seqEnd: 2,
    timestamp: "2026-01-01T00:00:01.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    text: "Hi there",
    corrected: false,
    ...overrides,
  } as CoreMessageEntry;
}

describe("isCoreMessageEntry", () => {
  it("accepts user-message and assistant-message kinds only", () => {
    const thinking: timeline.TranscriptEntry = {
      kind: "thinking",
      id: "row-3",
      epoch: "epoch-1",
      seqStart: 3,
      seqEnd: 3,
      timestamp: "2026-01-01T00:00:02.000Z",
      provider: "pi",
      pending: false,
      stale: false,
      text: "reasoning…",
    };
    expect(isCoreMessageEntry(userEntry())).toBe(true);
    expect(isCoreMessageEntry(assistantEntry())).toBe(true);
    expect(isCoreMessageEntry(thinking)).toBe(false);
  });
});

describe("TranscriptMessageRow", () => {
  it("distinguishes a user message by a visible label, not colour alone — and draws no visible label at all for assistant text (UI-P6)", () => {
    render(
      <>
        <TranscriptMessageRow entry={userEntry()} streaming={false} testId="row-user" />
        <TranscriptMessageRow entry={assistantEntry()} streaming={false} testId="row-assistant" />
      </>,
    );
    // T386: the visible speaker moved out of the bubble into the meta line
    // above it (the mockup's `.meta`), so the DOM carries the mockup's own
    // lowercase `you` — uppercased by CSS, never by a different string.
    const userRow = screen.getByTestId("row-user");
    const assistantRow = screen.getByTestId("row-assistant");
    // `testId` sits on the bubble (the `role="group"` element); the meta
    // line is its sibling inside the row wrapper.
    expect(userRow.parentElement?.querySelector(".pc-transcript__who")?.textContent).toBe("you");
    // UI-P6: the reference's `b.t === "text"` case renders no `.meta` line
    // at all — no `who`, no time — so an assistant row must carry no
    // *visible* `.pc-transcript__who` (the old defect stamped a mono
    // `PI <time>` label above every assistant message, flattening a long
    // transcript into a log of labels). Confirmed absent, not merely
    // differently labelled.
    expect(assistantRow.parentElement?.querySelector(".pc-transcript__who")).toBeNull();
    expect(assistantRow.parentElement?.querySelector(".pc-transcript__meta")).toBeNull();
    // The bubble's `role="group"` aria-label is still the accessible name
    // for BOTH rows regardless of the visible label's presence — this is
    // what keeps assistant speaker identity from being silently dropped
    // now that its visible label is gone (see the a11y describe block
    // below for the timestamp half of that same guarantee).
    expect(userRow.getAttribute("role")).toBe("group");
    expect(userRow.getAttribute("aria-label")).toBe("You");
    expect(assistantRow.getAttribute("role")).toBe("group");
    expect(assistantRow.getAttribute("aria-label")).toBe("Pi");
  });

  it("announces the streaming state as visible text, not only the cursor animation", () => {
    render(
      <TranscriptMessageRow
        entry={assistantEntry({ text: "Thinking about" })}
        streaming
        testId="row-streaming"
      />,
    );
    expect(screen.getByText("Pi is still responding")).toBeTruthy();
  });

  it("does not re-render when given the same entry, streaming flag, and testId", () => {
    const entry = assistantEntry();
    const { rerender, getByTestId } = render(
      <TranscriptMessageRow entry={entry} streaming={false} testId="row-stable" />,
    );
    const before = getByTestId("row-stable").parentElement;
    expect(before?.getAttribute("data-render-count")).toBe("1");

    // Re-render with a *new* object reference but identical field values —
    // the shape a parent list re-render produces when an unrelated row
    // changed. `React.memo`'s default reference equality would treat this
    // as a change; the custom comparator must not.
    rerender(<TranscriptMessageRow entry={{ ...entry }} streaming={false} testId="row-stable" />);
    const after = getByTestId("row-stable").parentElement;
    expect(after?.getAttribute("data-render-count")).toBe("1");
  });

  it("re-renders only when its own text changes", () => {
    const entry = assistantEntry({ text: "Hel" });
    const { rerender, getByTestId } = render(
      <TranscriptMessageRow entry={entry} streaming testId="row-live" />,
    );
    expect(getByTestId("row-live").parentElement?.getAttribute("data-render-count")).toBe("1");

    rerender(
      <TranscriptMessageRow entry={{ ...entry, text: "Hello" }} streaming testId="row-live" />,
    );
    expect(getByTestId("row-live").parentElement?.getAttribute("data-render-count")).toBe("2");
    expect(getByTestId("row-live").textContent).toContain("Hello");
  });

  it("bounds an oversized message instead of freezing on an unbounded text node", () => {
    const hugeText = "x".repeat(500_000);
    render(
      <TranscriptMessageRow
        entry={assistantEntry({ text: hugeText })}
        streaming={false}
        testId="row-huge"
      />,
    );
    const row = screen.getByTestId("row-huge");
    // Rendered content is bounded well below the source payload size...
    expect(row.textContent!.length).toBeLessThan(hugeText.length);
    // ...and the truncation is visible, not a silent drop.
    expect(row.textContent).toContain("truncated for display");
    // Still plain text: the raw payload is never reinterpreted as markup.
    expect(row.querySelector("script")).toBeNull();
  });

  it("renders a normal-length message unbounded and unchanged", () => {
    render(
      <TranscriptMessageRow entry={userEntry({ text: "A short message" })} streaming={false} />,
    );
    expect(screen.getByText("A short message")).toBeTruthy();
  });

  it("renders a message's images through MessageAttachments (T52A3)", () => {
    render(
      <TranscriptMessageRow
        entry={userEntry({
          images: [{ mimeType: "image/png", path: "/tmp/paseo-attachments-x/y.png", bytes: 1024 }],
        })}
        streaming={false}
        testId="row-with-image"
      />,
    );
    expect(screen.getByTestId("row-with-image-attachments")).toBeTruthy();
    expect(screen.getByText(/You attached an image/)).toBeTruthy();
  });

  it("renders nothing extra for a message with no images", () => {
    render(<TranscriptMessageRow entry={userEntry()} streaming={false} testId="row-no-image" />);
    expect(screen.queryByTestId("row-no-image-attachments")).toBeNull();
  });

  it("re-renders when the entry's images change even if text stays the same", () => {
    const entry = userEntry();
    const { rerender, getByTestId } = render(
      <TranscriptMessageRow entry={entry} streaming={false} testId="row-image-update" />,
    );
    expect(getByTestId("row-image-update").parentElement?.getAttribute("data-render-count")).toBe(
      "1",
    );

    rerender(
      <TranscriptMessageRow
        entry={{
          ...entry,
          images: [{ mimeType: "image/png", path: "/tmp/paseo-attachments-x/z.png", bytes: 512 }],
        }}
        streaming={false}
        testId="row-image-update"
      />,
    );
    expect(getByTestId("row-image-update").parentElement?.getAttribute("data-render-count")).toBe(
      "2",
    );
  });

  it("renders no edit-from-here affordance at all when no handler is supplied (every existing caller, unaffected)", () => {
    render(<TranscriptMessageRow entry={userEntry()} streaming={false} testId="row-no-edit" />);
    expect(screen.queryByRole("button", { name: "Edit from here" })).toBeNull();
  });

  it("never renders an edit-from-here affordance on an assistant message, even with a handler", () => {
    render(
      <TranscriptMessageRow
        entry={assistantEntry()}
        streaming={false}
        onEditFromHere={vi.fn()}
        canEditFromHere
        testId="row-assistant-edit"
      />,
    );
    expect(screen.queryByRole("button", { name: "Edit from here" })).toBeNull();
  });

  it("calls onEditFromHere with the message's own id when its button is activated", async () => {
    const user = userEvent.setup();
    const onEditFromHere = vi.fn();
    render(
      <TranscriptMessageRow
        entry={userEntry({ id: "msg-9" })}
        streaming={false}
        onEditFromHere={onEditFromHere}
        canEditFromHere
        testId="row-edit"
      />,
    );

    await user.click(screen.getByTestId("row-edit-edit-from-here"));

    expect(onEditFromHere).toHaveBeenCalledTimes(1);
    expect(onEditFromHere).toHaveBeenCalledWith("msg-9");
  });

  it("disables (not hides) the edit-from-here button when canEditFromHere is false — a reasoned rejection, not a hidden affordance", async () => {
    const user = userEvent.setup();
    const onEditFromHere = vi.fn();
    render(
      <TranscriptMessageRow
        entry={userEntry()}
        streaming={false}
        onEditFromHere={onEditFromHere}
        canEditFromHere={false}
        testId="row-edit-disabled"
      />,
    );

    const button = screen.getByTestId("row-edit-disabled-edit-from-here");
    expect(button.hasAttribute("hidden")).toBe(false);
    expect(button.hasAttribute("disabled")).toBe(true);

    await user.click(button);
    expect(onEditFromHere).not.toHaveBeenCalled();
  });

  it("has no axe violations for a message carrying an image", async () => {
    const { container } = render(
      <TranscriptMessageRow
        entry={assistantEntry({
          images: [{ mimeType: "image/jpeg", path: "/tmp/paseo-attachments-x/w.jpg", bytes: 2048 }],
        })}
        streaming={false}
        testId="row-image-axe"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("message timestamp (T308)", () => {
  /**
   * The row calls `formatMessageTimestamp(entry.timestamp)` with no options,
   * so the VISIBLE text is deliberately rendered in the host's own zone and
   * locale — which is the product requirement and also means asserting exact
   * digits here would make this file pass or fail by machine. So the visible
   * label is asserted by shape, and the machine-readable `dateTime`
   * attribute — which is `date.toISOString()`, zone-independent — is
   * asserted exactly. `formatMessageTimestamp`'s own test
   * (`packages/frontend-core/src/timeline/message-timestamp.test.ts`) pins
   * the formatting itself against a fixed zone.
   */
  it("UI-P6: an assistant message's timestamp still exists in the DOM but is visually hidden, not deleted", () => {
    // The reference draws no meta line — visible or otherwise — for an
    // assistant text turn, but nothing else on this row conveys *when* it
    // was sent (unlike speaker identity, which the bubble's own
    // `role="group"` aria-label still carries regardless). Deleting this
    // element outright would silently take that information away from
    // screen-reader users while sighted users simply never had it, so it
    // stays in the DOM, clipped off-screen with the repository's standard
    // `.pc-visually-hidden` treatment, rather than being dropped.
    render(
      <TranscriptMessageRow
        entry={assistantEntry({ timestamp: "2026-09-09T12:12:08.000Z" })}
        streaming={false}
        testId="row-stamp-a"
      />,
    );

    const stamp = screen.getByTestId("row-stamp-a-timestamp");
    expect(stamp.tagName).toBe("TIME");
    expect(stamp.getAttribute("datetime")).toBe("2026-09-09T12:12:08.000Z");
    expect(stamp.textContent).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(stamp.className).toBe("pc-visually-hidden");
    // It also carries no visible `.pc-transcript__timestamp` sibling — the
    // hidden `<time>` above is the ONLY timestamp node this row renders.
    const rowRoot = screen.getByTestId("row-stamp-a").parentElement;
    expect(rowRoot?.querySelector(".pc-transcript__timestamp")).toBeNull();
  });

  it("renders a visible timestamp under a user message", () => {
    render(
      <TranscriptMessageRow
        entry={userEntry({ timestamp: "2026-09-09T12:12:08.000Z" })}
        streaming={false}
        testId="row-stamp-u"
      />,
    );

    const stamp = screen.getByTestId("row-stamp-u-timestamp");
    expect(stamp.getAttribute("datetime")).toBe("2026-09-09T12:12:08.000Z");
    // Unlike the assistant case above, a user turn's meta line (who + time)
    // stays visible, exactly matching the reference's `b.t === "user"` case.
    expect(stamp.className).toBe("pc-transcript__timestamp");
  });

  it("carries the full dated time as a title, since the visible label may omit the date", () => {
    render(
      <TranscriptMessageRow
        entry={assistantEntry({ timestamp: "2026-09-09T12:12:08.000Z" })}
        streaming={false}
        testId="row-stamp-title"
      />,
    );

    const title = screen.getByTestId("row-stamp-title-timestamp").getAttribute("title");
    expect(title).toContain("2026");
    expect(title).toContain("September");
  });

  it("renders no timestamp element at all for an unparseable timestamp", () => {
    render(
      <TranscriptMessageRow
        entry={assistantEntry({ timestamp: "not a date" })}
        streaming={false}
        testId="row-stamp-bad"
      />,
    );

    // "Invalid Date" must never reach the transcript — the element is absent.
    expect(screen.queryByTestId("row-stamp-bad-timestamp")).toBeNull();
    expect(screen.getByTestId("row-stamp-bad").textContent).not.toContain("Invalid");
  });

  it("re-renders when only the timestamp changes", () => {
    // The memo comparator must read every field the row displays. Before
    // T308 added `timestamp` to `areRowPropsEqual`, this row would have kept
    // showing an optimistic row's local submission time after the daemon's
    // own timestamp reconciled it.
    const entry = userEntry({ timestamp: "2026-09-09T12:12:08.000Z" });
    const { rerender } = render(
      <TranscriptMessageRow entry={entry} streaming={false} testId="row-stamp-memo" />,
    );
    expect(
      screen.getByTestId("row-stamp-memo").parentElement?.getAttribute("data-render-count"),
    ).toBe("1");

    rerender(
      <TranscriptMessageRow
        entry={{ ...entry, timestamp: "2026-09-09T13:13:09.000Z" }}
        streaming={false}
        testId="row-stamp-memo"
      />,
    );
    expect(
      screen.getByTestId("row-stamp-memo").parentElement?.getAttribute("data-render-count"),
    ).toBe("2");
    expect(screen.getByTestId("row-stamp-memo-timestamp").getAttribute("datetime")).toBe(
      "2026-09-09T13:13:09.000Z",
    );
  });

  it("keeps the row accessible with the timestamp present", async () => {
    const { container } = render(
      <TranscriptMessageRow
        entry={assistantEntry({ timestamp: "2026-09-09T12:12:08.000Z" })}
        streaming={false}
        testId="row-stamp-axe"
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * UI-P5 (plan.md §10.1/§10.4, the reference's `.turn-user .body`): a real
 * deployed build showed `.pc-message--user` present in the DOM but its
 * text node (`.pc-message__text, .pc-message__body` — the second class
 * does not exist in this tree) computing a transparent background, `0`
 * radius, and `0` padding — no visible bubble at all.
 *
 * **Root cause, measured rather than guessed.** `ui/recipes/recipes.css`'s
 * `.pc-message--user` rule already declares the bubble fill
 * (`background-color: var(--color-accent-tint)`), corner
 * (`border-radius: var(--radius-window)`), and inset (`padding: 11px
 * 14px`, kept as local custom properties) on the exact root node
 * `StreamingMessage` renders for a user message — confirmed directly by
 * rendering that real component tree with the real stylesheet text
 * injected into this suite's jsdom document and inspecting the resulting
 * DOM/CSSOM, not assumed from reading the source. What the earlier
 * live-browser measurement actually caught is a verification gap, not a
 * missing declaration: this suite's own jsdom environment does not
 * resolve `var(...)` in `getComputedStyle` — probed directly, the very
 * node this rule targets reports `backgroundColor: ""`, `paddingTop:
 * ""`, and `borderRadius: "var(--radius-window)"` (the literal,
 * unresolved token text) even though the selector matches and the
 * declaration is present. That is the same "check that cannot fail" trap
 * this file's own T305 suite (`recipes.test.tsx`) already documents for
 * `white-space: pre-wrap` on this selector's sibling: any earlier claim
 * that this bubble was "token-correct" from a `getComputedStyle` read in
 * this environment could not have proven anything either way. The tests
 * below therefore never read a resolved colour from jsdom; they assert
 * the stylesheet's declared intent (against the real `recipes.css` text)
 * and the DOM wiring (that the row's own `data-testid` node — the one a
 * real browser paints — is the exact element carrying the class that
 * rule targets, with the text kept a plain descendant of it), which
 * together is what an actual regression here would break.
 */
describe("TranscriptMessageRow user bubble (UI-P5)", () => {
  const recipesCss = () =>
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../ui/recipes/recipes.css"),
      "utf8",
    );

  const ruleBodyFor = (selector: string) => {
    const css = recipesCss().replace(/\/\*[\s\S]*?\*\//g, "");
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} not found in recipes.css`).toBeGreaterThanOrEqual(0);
    const close = css.indexOf("}", at);
    expect(close, `${selector} has no closing brace`).toBeGreaterThan(at);
    return css.slice(at, close);
  };

  it("declares a filled, rounded, padded bubble on .pc-message--user, sourced from tokens", () => {
    const body = ruleBodyFor(".pc-message--user");
    expect(body).toMatch(/background-color:\s*var\(--color-accent-tint\)\s*;/);
    expect(body).toMatch(/border-radius:\s*var\(--radius-window\)\s*;/);
    expect(body).toMatch(/padding:\s*[^;]+;/);
    // Every value must come from a token or a local custom property
    // quoting the reference (documented above it) — never a raw hex.
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("keeps the base .pc-message and the text run themselves unboxed", () => {
    // The bubble lives ONLY on the `--user` modifier: the base rule (both
    // speakers) and the text paragraph (inside the bubble) must not also
    // carry a fill/radius/padding, or the reference's "assistant prose is
    // never boxed" rule (this file's own UI-W10 correction, above) would
    // be silently reintroduced for one speaker or blur the two apart.
    expect(ruleBodyFor(".pc-message")).not.toMatch(/background|border-radius/);
    expect(ruleBodyFor(".pc-message__text")).not.toMatch(/background-color|border-radius|padding/);
  });

  it("puts the class recipes.css targets on the row's own stable testid node", () => {
    render(<TranscriptMessageRow entry={userEntry()} streaming={false} testId="row-bubble" />);
    // `getByTestId` returns the row's `role="group"` element (see
    // "distinguishes user and assistant messages..." above) — the same
    // node a real browser paints the bubble on. Asserting the class HERE,
    // not just that the class exists somewhere on the page, is what fails
    // this test if a future change renames the class or moves
    // `data-testid`/`role="group"` onto a different element than the one
    // `.pc-message--user` selects.
    const bubble = screen.getByTestId("row-bubble");
    expect(bubble.classList.contains("pc-message--user")).toBe(true);
  });

  it("keeps the bubble class off an assistant row's own testid node", () => {
    render(
      <TranscriptMessageRow entry={assistantEntry()} streaming={false} testId="row-bubble-a" />,
    );
    expect(screen.getByTestId("row-bubble-a").classList.contains("pc-message--user")).toBe(false);
  });

  it("keeps the text a plain .pc-message__text descendant of the bubble node, not a sibling", () => {
    render(<TranscriptMessageRow entry={userEntry()} streaming={false} testId="row-bubble-nest" />);
    const bubble = screen.getByTestId("row-bubble-nest");
    // A refactor that lifts the text OUT of the bubble-classed element (or
    // renames `.pc-message__text`) must fail here rather than only look
    // fine — the exact "targets a descendant the component doesn't
    // render" failure mode this task named as a candidate cause.
    const text = bubble.querySelector(".pc-message__text");
    expect(text).not.toBeNull();
    expect(text?.textContent).toBe("Hi Pi");
  });

  it("resolves --color-accent-tint and --radius-window in both themes", () => {
    const themeCss = generateThemeCss();
    expect(themeCss).toMatch(/\[data-theme="light"\][^}]*--color-accent-tint:\s*[^;]+;/);
    expect(themeCss).toMatch(/\[data-theme="dark"\][^}]*--color-accent-tint:\s*[^;]+;/);
    expect(themeCss).toMatch(/--radius-window:\s*[^;]+;/);
  });
});

describe("T308: only message rows carry a timestamp", () => {
  /**
   * The requirement is explicit that reasoning, tool-call, and compaction
   * rows must NOT be dated — they are process detail, not something either
   * party said. Nothing enforces that beyond those files not asking for it,
   * which is exactly the kind of "true today, silently false tomorrow"
   * property worth pinning: a later task adding a footer to one of those
   * rows should have to see this assertion and decide deliberately.
   */
  const others = ["thinking-row.tsx", "tool-call-row.tsx", "compaction-row.tsx"];

  it.each(others)("%s renders no timestamp", (file) => {
    // The `join(dirname(fileURLToPath(...)))` form, matching
    // `transcript.test.tsx`'s own CSS read. Under this workspace's jsdom
    // config `import.meta.url` is a served path, not a real file URL, so
    // `new URL("./x", import.meta.url)` resolves the drive letter away and
    // reads `D:\src\...`; taking `dirname` of the converted path avoids it.
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), "utf8");
    expect(source).not.toContain("pc-transcript__timestamp");
    expect(source).not.toContain("formatMessageTimestamp");
  });
});
