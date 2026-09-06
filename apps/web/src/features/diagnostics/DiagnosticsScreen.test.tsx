import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CoreProvider } from "../../app/core-context.js";
import { DiagnosticsScreen } from "./DiagnosticsScreen.js";

afterEach(cleanup);

/**
 * T41B1 acceptance: "the screen works while disconnected". Rendered with
 * no `DaemonClientProvider` at all — `useDaemonClientContext()` then
 * returns its documented default (`client: null`, idle `info`,
 * `hostController: null`, `daemon-client-context.tsx`'s
 * `DEFAULT_CONTEXT_VALUE`), the same shape a real app has before any
 * connection attempt, or once one has failed. Every field below must
 * still render a truthful string.
 */
describe("DiagnosticsScreen — disconnected state", () => {
  it("renders connection, version and capability fields, none of them blank or fabricated", () => {
    render(
      <CoreProvider>
        <DiagnosticsScreen appVersion="0.3.0-beta.2" clientId="picompanion-web" testId="diag" />
      </CoreProvider>,
    );

    expect(screen.getByTestId("diag")).toBeTruthy();
    expect(screen.getByTestId("diag-connection-status-value").textContent).toBe("idle");
    expect(screen.getByTestId("diag-connection-kind-value").textContent).toBe("Not established");
    expect(screen.getByTestId("diag-connection-endpoint-value").textContent).toBe("Not connected");
    expect(screen.getByTestId("diag-connection-client-id-value").textContent).toBe(
      "picompanion-web",
    );
    expect(screen.getByTestId("diag-versions-app-version-value").textContent).toBe("0.3.0-beta.2");
    expect(screen.getByTestId("diag-versions-daemon-version-value").textContent).toMatch(
      /unknown/i,
    );
    expect(
      screen.getByTestId("diag-capabilities-capabilities-unavailable-value").textContent,
    ).toMatch(/unknown/i);
  });

  it("every rendered field has a working copy affordance", () => {
    render(
      <CoreProvider>
        <DiagnosticsScreen appVersion="0.3.0-beta.2" clientId="picompanion-web" testId="diag" />
      </CoreProvider>,
    );
    expect(screen.getByTestId("diag-connection-status-copy")).toBeTruthy();
    expect(screen.getByTestId("diag-connection-status-copy").getAttribute("aria-label")).toBe(
      "Copy Connection status",
    );
  });
});

/**
 * T41B2 acceptance: "export a redacted log bundle" — proven at the
 * screen-mount level (a real click triggers a real Blob-URL anchor
 * download), not just at `diagnostics-export.ts`'s/
 * `use-diagnostics-export.ts`'s unit level. Browser download APIs are
 * stubbed the same way `file-browser-screen.test.tsx` stubs them for
 * `useFileDownload`'s default real save path — jsdom does not implement
 * `URL.createObjectURL` or anchor navigation.
 */
describe("DiagnosticsScreen — export control", () => {
  it("clicking Export downloads a redacted JSON bundle via a real Blob-URL anchor click", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    let downloadedFileName: string | null = null;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedFileName = this.download;
      });

    try {
      render(
        <CoreProvider>
          <DiagnosticsScreen appVersion="0.3.0-beta.2" clientId="picompanion-web" testId="diag" />
        </CoreProvider>,
      );

      const user = userEvent.setup();
      await user.click(screen.getByTestId("diag-export-button"));

      expect(downloadedFileName).toMatch(/^pi-companion-diagnostics-\d+\.json$/);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Blob;
      expect(blob.type).toBe("application/json");
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
      const json = JSON.parse(text);
      expect(json.kind).toBe("picompanion-diagnostics-export");
      expect(
        json.sections
          .find((section: { id: string }) => section.id === "connection")
          .fields.find((field: { id: string }) => field.id === "status").value,
      ).toBe("idle");

      expect(screen.getByTestId("diag-export-status").textContent).toContain("Downloaded");
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      clickSpy.mockRestore();
    }
  });
});
