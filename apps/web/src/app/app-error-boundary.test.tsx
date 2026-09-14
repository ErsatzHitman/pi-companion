import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "@picompanion/frontend-core";

import { AppErrorBoundaryView } from "./app-error-boundary.js";

function makeFakeLogger(): Logger & { errors: Array<{ message: string; fields?: unknown }> } {
  const errors: Array<{ message: string; fields?: unknown }> = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message, fields) => {
      errors.push({ message, fields });
    },
    child: () => logger,
  };
  return Object.assign(logger, { errors });
}

function Boom(): never {
  throw new Error("boom from a child render");
}

describe("AppErrorBoundaryView (FIX-W3)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the in-app error state instead of a blank tree when a child throws during render", () => {
    const logger = makeFakeLogger();
    // React itself also logs the thrown error to the console; suppress
    // that expected noise for this test.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <AppErrorBoundaryView logger={logger} testId="app-error-boundary">
          <Boom />
        </AppErrorBoundaryView>,
      );
    } finally {
      consoleError.mockRestore();
    }

    const alert = screen.getByTestId("app-error-boundary");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.getByText("boom from a child render")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]?.message).toBe(
      "Unhandled render error reached the root error boundary",
    );
  });

  it("resets on 'Try again' and gives the crashed subtree a fresh mount", () => {
    const logger = makeFakeLogger();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("first render fails");
      return <div data-testid="recovered">back</div>;
    }

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppErrorBoundaryView logger={logger}>
        <Flaky />
      </AppErrorBoundaryView>,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();

    // The next mount attempt (triggered by "Try again") succeeds.
    shouldThrow = false;
    act(() => {
      screen.getByRole("button", { name: "Try again" }).click();
    });
    consoleError.mockRestore();

    expect(screen.getByTestId("recovered")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("renders children normally when nothing throws", () => {
    const logger = makeFakeLogger();
    render(
      <AppErrorBoundaryView logger={logger}>
        <div data-testid="ok">fine</div>
      </AppErrorBoundaryView>,
    );

    expect(screen.getByTestId("ok")).toBeTruthy();
    expect(logger.errors).toHaveLength(0);
  });
});
