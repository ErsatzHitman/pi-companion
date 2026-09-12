import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { OfflineTranscriptBanner } from "./OfflineTranscriptBanner.js";

afterEach(cleanup);

describe("OfflineTranscriptBanner (T393)", () => {
  it("renders nothing while connected", () => {
    render(<OfflineTranscriptBanner connected hasEntries cachedAt={0} testId="offline-banner" />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });

  it("renders nothing when there is no transcript to caveat", () => {
    render(
      <OfflineTranscriptBanner
        connected={false}
        hasEntries={false}
        cachedAt={0}
        testId="offline-banner"
      />,
    );
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });

  it("announces cached/offline with the last-seen time and the concrete unavailability", () => {
    render(
      <OfflineTranscriptBanner
        connected={false}
        hasEntries
        cachedAt={0}
        now={5 * 60 * 1000}
        testId="offline-banner"
      />,
    );
    const banner = screen.getByTestId("offline-banner");
    expect(banner.textContent).toContain("Offline");
    expect(banner.textContent).toContain("saved 5 minutes ago");
    expect(banner.textContent).toContain("push notifications are unavailable");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <OfflineTranscriptBanner
        connected={false}
        hasEntries
        cachedAt={null}
        testId="offline-banner"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
