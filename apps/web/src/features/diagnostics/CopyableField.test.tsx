import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CoreProvider } from "../../app/core-context.js";
import { CopyableField } from "./CopyableField.js";

afterEach(cleanup);

function stubClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
}

describe("CopyableField", () => {
  it("copies the real value via the shared platform Clipboard and shows a visible confirmation", async () => {
    // `userEvent.setup()` installs its own `navigator.clipboard` stub;
    // spy on it afterward rather than defining our own first (matching
    // `tool-call-row.test.tsx`'s established pattern in this repo).
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    render(
      <CoreProvider>
        <CopyableField label="Server id" value="server-abc-123" testId="diag-server-id" />
      </CoreProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Copy Server id" }));
    expect(writeText).toHaveBeenCalledWith("server-abc-123");
    const status = await screen.findByTestId("diag-server-id-status");
    expect(status.textContent).toContain("Copied");
  });

  it("surfaces an unavailable clipboard as a VISIBLE failure, never a silent 'Copied'", async () => {
    // Deliberately `fireEvent`, not `userEvent`: `userEvent.setup()`
    // installs its own working `navigator.clipboard` stub the moment
    // it runs, which would silently override `stubClipboard(undefined)`
    // below and make this assert nothing — reproduced against this
    // exact component before this test was rewritten: with
    // `userEvent.setup()` called after `stubClipboard(undefined)`, the
    // click still resolved through userEvent's own clipboard mock and
    // showed "Copied", proving the intended failure path was never hit.
    render(
      <CoreProvider>
        <CopyableField label="Server id" value="server-abc-123" testId="diag-server-id" />
      </CoreProvider>,
    );
    stubClipboard(undefined);

    fireEvent.click(screen.getByRole("button", { name: "Copy Server id" }));
    const status = await screen.findByTestId("diag-server-id-status");
    expect(status.textContent).toContain("Copy failed");
    expect(status.textContent).not.toContain("Copied");
  });

  it("surfaces a denied clipboard write (writeText rejects) as a visible failure with the real reason", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("Clipboard permission denied"),
    );

    render(
      <CoreProvider>
        <CopyableField label="Server id" value="server-abc-123" testId="diag-server-id" />
      </CoreProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Copy Server id" }));
    const status = await screen.findByTestId("diag-server-id-status");
    expect(status.textContent).toContain("Copy failed");
    expect(status.textContent).toContain("Clipboard permission denied");
  });

  it("always renders the real value as text, independent of copy state", () => {
    render(
      <CoreProvider>
        <CopyableField label="Server id" value="server-abc-123" testId="diag-server-id" />
      </CoreProvider>,
    );
    expect(screen.getByTestId("diag-server-id-value").textContent).toBe("server-abc-123");
  });
});
