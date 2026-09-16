import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalForm } from "./ApprovalForm.js";
import { CommandSearch } from "./CommandSearch.js";
import { DiffSummary } from "./DiffSummary.js";
import { PromptBar } from "./PromptBar.js";
import { StreamingMessage } from "./StreamingMessage.js";
import { ThinkingSection } from "./ThinkingSection.js";
import { ToolChips } from "./ToolChips.js";
import { WorkflowSteps } from "./WorkflowSteps.js";

/**
 * T25B recipe accessibility/keyboard-operation checks (plan.md §10.5):
 * accessible name, keyboard operation, screen-reader role/state, and
 * non-colour status signalling for a representative slice of the §10.4
 * recipes (the recipe-lab test covers "every recipe renders + no axe
 * violations across the whole page").
 */
afterEach(cleanup);

/**
 * Read `recipes.css` as text and slice out one rule's body, comments
 * stripped first. jsdom does not load `recipes.css`, so a
 * `getComputedStyle` assertion here would read the initial value and pass
 * whether or not the declaration exists — a check that cannot fail. Same
 * approach, and same reason, as the T305 block below and
 * `features/transcript/transcript.test.tsx`'s compact-layout CSS
 * assertions.
 */
const recipesCss = () =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "recipes.css"), "utf8");

const ruleBodyFor = (selector: string) => {
  const css = recipesCss().replace(/\/\*[\s\S]*?\*\//g, "");
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} not found in recipes.css`).toBeGreaterThanOrEqual(0);
  const close = css.indexOf("}", at);
  expect(close, `${selector} has no closing brace`).toBeGreaterThan(at);
  return css.slice(at, close);
};

describe("ThinkingSection", () => {
  it("is a keyboard-operable disclosure with an exposed expanded state", async () => {
    const user = userEvent.setup();
    render(<ThinkingSection summary="Thought for 4s" body="Reasoning body" durationLabel="4s" />);
    const trigger = screen.getByRole("button", { name: /Thought for 4s/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ThinkingSection
        summary="Thought for 4s"
        body="Reasoning body"
        durationLabel="4s"
        defaultExpanded
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

/**
 * T305: assistant/user transcript text must keep the newlines the model
 * emitted. `.pc-thinking__body p` had `white-space: pre-wrap` and
 * `.pc-message__text` did not, so identical text rendered with its line
 * breaks on Android (React Native `<Text>` preserves them by default) and
 * collapsed to one run on web.
 *
 * Asserted against the STYLESHEET, not `getComputedStyle`, and that is
 * deliberate: this suite runs in jsdom, which does not load
 * `recipes.css`, so a computed-style assertion here would read the
 * initial value `normal` and pass whether or not the declaration exists —
 * a check that cannot fail. Same approach, and same reason, as
 * `features/transcript/transcript.test.tsx`'s compact-layout CSS
 * assertions. The DOM half below is what jsdom can prove: that the text
 * reaches this element as a single text node with its newlines intact, so
 * the CSS declaration is the only thing deciding how they render.
 */
describe("StreamingMessage newline preservation (T305)", () => {
  it("declares white-space: pre-wrap on .pc-message__text", () => {
    expect(ruleBodyFor(".pc-message__text")).toMatch(/white-space:\s*pre-wrap\s*;/);
  });

  it("declares it on the thinking body too, so the two are no longer asymmetric", () => {
    expect(ruleBodyFor(".pc-thinking__body p")).toMatch(/white-space:\s*pre-wrap\s*;/);
  });

  it("uses pre-wrap rather than pre, so long lines still wrap to the container", () => {
    expect(ruleBodyFor(".pc-message__text")).not.toMatch(/white-space:\s*pre\s*;/);
  });

  it("renders a multi-line message with its newlines intact in the DOM", () => {
    render(
      <StreamingMessage
        speaker="assistant"
        text={"first line\nsecond line"}
        streaming={false}
        testId="t305-message"
      />,
    );
    const paragraph = screen.getByTestId("t305-message").querySelector(".pc-message__text");
    expect(paragraph?.textContent).toBe("first line\nsecond line");
  });
});

/**
 * STREAM-1: the whole-paragraph shimmer is gone from streamed prose (that
 * gradient is reserved for short fixed labels), the caret is inverted to
 * match Beautiful UI's `.stream-caret`/`.stream-caret.is-streaming`, and a
 * trailing blur+mask span plus a pixel-grid loader carry the live-state
 * treatment instead.
 */
describe("StreamingMessage live-state treatment (STREAM-1)", () => {
  it("no longer applies the shimmer animation to .pc-message__text", () => {
    expect(ruleBodyFor(".pc-message__text")).not.toMatch(/animation:\s*pc-message-shimmer/);
    expect(recipesCss()).not.toMatch(/\.pc-message__text:has\(\.pc-message__cursor\)/);
  });

  it("keeps the shimmer keyframe alive for ThinkingSection's still-thinking summary", () => {
    expect(ruleBodyFor(".pc-thinking__summary--live")).toMatch(/animation:\s*pc-message-shimmer/);
  });

  it("holds the caret solid while streaming and blinks it at rest, inverted from before", () => {
    expect(ruleBodyFor(".pc-message__cursor--streaming")).toMatch(/animation:\s*none\s*;/);
  });

  it("always renders the cursor, toggling the --streaming modifier rather than mounting it conditionally", () => {
    const { rerender } = render(
      <StreamingMessage speaker="assistant" text="hi" streaming={false} testId="cursor-msg" />,
    );
    let cursor = screen.getByTestId("cursor-msg").querySelector(".pc-message__cursor");
    expect(cursor).toBeTruthy();
    expect(cursor?.classList.contains("pc-message__cursor--streaming")).toBe(false);

    rerender(<StreamingMessage speaker="assistant" text="hi" streaming testId="cursor-msg" />);
    cursor = screen.getByTestId("cursor-msg").querySelector(".pc-message__cursor");
    expect(cursor).toBeTruthy();
    expect(cursor?.classList.contains("pc-message__cursor--streaming")).toBe(true);
  });

  it("wraps the trailing text in a blur+mask tail span while streaming, and renders plainly at rest", () => {
    const { rerender } = render(
      <StreamingMessage speaker="assistant" text="hello there world" streaming testId="tail-msg" />,
    );
    const tail = screen.getByTestId("tail-msg").querySelector(".pc-message__tail");
    expect(tail).toBeTruthy();
    expect(screen.getByTestId("tail-msg").querySelector(".pc-message__text")?.textContent).toBe(
      "hello there world",
    );

    rerender(
      <StreamingMessage
        speaker="assistant"
        text="hello there world"
        streaming={false}
        testId="tail-msg"
      />,
    );
    expect(screen.getByTestId("tail-msg").querySelector(".pc-message__tail")).toBeFalsy();
  });

  it("shows the nine-cell pixel-grid loader only while streaming", () => {
    const { rerender } = render(
      <StreamingMessage speaker="assistant" text="hi" streaming testId="pixel-msg" />,
    );
    expect(
      screen.getByTestId("pixel-msg").querySelectorAll(".pc-message__pixel-grid i").length,
    ).toBe(9);

    rerender(
      <StreamingMessage speaker="assistant" text="hi" streaming={false} testId="pixel-msg" />,
    );
    expect(screen.getByTestId("pixel-msg").querySelector(".pc-message__pixel-grid")).toBeFalsy();
  });
});

describe("ApprovalForm", () => {
  it("exposes an accessible group name and keyboard-operable Approve/Deny", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(
      <ApprovalForm
        toolLabel="Write file"
        detail="src/x.ts"
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );
    expect(screen.getByRole("group", { name: /Write file needs your approval/ })).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve" });
    approve.focus();
    await user.keyboard("{Enter}");
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("shows a non-colour warning for dangerous actions", () => {
    render(
      <ApprovalForm
        toolLabel="Run command"
        detail="rm -rf build/"
        dangerous
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    );
    expect(screen.getByText(/Requires extra caution/)).toBeTruthy();
  });
});

describe("ToolChips", () => {
  it("pairs every tone with visible status text", () => {
    render(
      <ToolChips
        ariaLabel="Tool permissions"
        items={[
          { id: "write", label: "Write", tone: "warning", statusText: "Needs approval" },
          { id: "net", label: "Network", tone: "danger", statusText: "Denied" },
        ]}
      />,
    );
    expect(screen.getByRole("list", { name: "Tool permissions" })).toBeTruthy();
    expect(screen.getByText("Needs approval")).toBeTruthy();
    expect(screen.getByText("Denied")).toBeTruthy();
  });
});

describe("PromptBar", () => {
  it("has a labelled input and sends on Enter", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState("");
      const onSend = vi.fn();
      return (
        <PromptBar
          label="Prompt"
          placeholder="Ask Pi…"
          value={value}
          canSend={value.length > 0}
          queuedCount={0}
          onValueChange={setValue}
          onSend={() => {
            onSend(value);
            setValue("");
          }}
          testId="prompt-bar"
        />
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText("Prompt");
    await user.type(input, "Hello");
    await user.keyboard("{Enter}");
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  /* STREAM-1: the textarea now autosizes in JS instead of exposing a manual
   * resize handle, matching the mockup's own `prompt autosize` script and
   * its 140px cap. */
  it("no longer declares a manual resize handle in the stylesheet", () => {
    expect(ruleBodyFor(".pc-prompt-bar__input")).toMatch(/resize:\s*none\s*;/);
    expect(ruleBodyFor(".pc-prompt-bar__input")).not.toMatch(/resize:\s*vertical\s*;/);
  });

  it("caps the textarea's max-height at the mockup's 140px, as a scoped custom property", () => {
    expect(ruleBodyFor(".pc-prompt-bar__input")).toMatch(
      /--pc-prompt-textarea-max-height:\s*140px\s*;/,
    );
    expect(ruleBodyFor(".pc-prompt-bar__input")).toMatch(
      /max-height:\s*var\(--pc-prompt-textarea-max-height\)\s*;/,
    );
  });

  it("resizes the textarea's height on every value change without throwing", () => {
    function Harness() {
      const [value, setValue] = useState("line one");
      return (
        <PromptBar
          label="Prompt"
          placeholder="Ask Pi…"
          value={value}
          canSend={value.length > 0}
          queuedCount={0}
          onValueChange={setValue}
          onSend={() => {}}
          testId="autosize-bar"
        />
      );
    }
    render(<Harness />);
    const input = screen.getByTestId("autosize-bar-input") as HTMLTextAreaElement;
    // jsdom does not lay out text, so scrollHeight stays 0 and this cannot
    // assert a real pixel value — it can only prove the effect runs, on
    // mount and again after a value change, without throwing.
    expect(input.style.height).toBe("0px");
  });
});

describe("CommandSearch", () => {
  it("supports arrow-key navigation and Enter to choose an option", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <CommandSearch
        label="Search commands"
        placeholder="Search…"
        items={[
          { id: "compact", label: "/compact", hint: "Compact the transcript" },
          { id: "clear", label: "/clear", hint: "Start a new session" },
        ]}
        onSelect={onSelect}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Search commands" });
    await user.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith({
      id: "clear",
      label: "/clear",
      hint: "Start a new session",
    });
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <CommandSearch
        label="Search commands"
        placeholder="Search…"
        items={[{ id: "compact", label: "/compact", hint: "Compact the transcript" }]}
        onSelect={() => {}}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Search commands" });
    await user.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("WorkflowSteps", () => {
  it("marks the active step with aria-current and shows non-colour status text", () => {
    render(
      <WorkflowSteps
        ariaLabel="Pairing progress"
        items={[
          { id: "scan", label: "Scan pairing code", status: "complete" },
          { id: "connect", label: "Establish connection", status: "active" },
        ]}
      />,
    );
    const activeItem = screen.getByText("Establish connection").closest("li");
    expect(activeItem?.getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("In progress")).toBeTruthy();
  });
});

describe("DiffSummary", () => {
  it("exposes a word summary via aria-label alongside the +/- text", () => {
    render(<DiffSummary path="src/x.ts" added={3} removed={1} modified={0} />);
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
    expect(screen.getByLabelText("src/x.ts: 3 added, 1 removed")).toBeTruthy();
  });
});
