import { cleanup, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import {
  isExtensionSnapshotEntry,
  TranscriptExtensionSnapshotRow,
} from "./extension-snapshot-row.js";
import type { ExtensionSnapshotTranscriptEntry } from "./extension-snapshot-row.js";

afterEach(cleanup);

function snapshotEntry(overrides: Record<string, unknown> = {}): ExtensionSnapshotTranscriptEntry {
  return {
    kind: "extension-snapshot",
    id: "row-snap",
    epoch: "epoch-1",
    seqStart: 10,
    seqEnd: 10,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    state: {
      agentId: "agent-1",
      revision: 3,
      updatedAt: "2026-01-01T00:00:00.000Z",
      elements: [
        {
          id: "el-1",
          ns: "pi-goal",
          kind: "status",
          placement: "rail",
          payload: { kind: "status", text: "On track" },
        },
        {
          id: "el-2",
          ns: "workflow",
          kind: "progress",
          placement: "rail",
          title: "Migration",
          payload: { kind: "progress", value: 1, max: 4 },
        },
      ],
    },
    ...overrides,
  } as unknown as ExtensionSnapshotTranscriptEntry;
}

describe("isExtensionSnapshotEntry", () => {
  it("accepts only the extension-snapshot kind", () => {
    const message: timeline.TranscriptEntry = {
      kind: "user-message",
      id: "row-1",
      epoch: "epoch-1",
      seqStart: 1,
      seqEnd: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      provider: "pi",
      pending: false,
      stale: false,
      text: "hi",
    };
    expect(isExtensionSnapshotEntry(snapshotEntry())).toBe(true);
    expect(isExtensionSnapshotEntry(message)).toBe(false);
  });
});

describe("TranscriptExtensionSnapshotRow", () => {
  it("prints the element count and one summary line per element", () => {
    render(<TranscriptExtensionSnapshotRow entry={snapshotEntry()} testId="snap-1" />);
    const card = screen.getByTestId("snap-1");
    expect(within(card).getByText("Extension snapshot — 2 elements")).toBeTruthy();
    // The rail's own summary vocabulary, not raw payload: a status reads
    // its text, a progress reads its value/max.
    expect(card.textContent).toContain("On track");
    expect(card.textContent).toContain("1/4");
    // A titled element shows its title rather than its namespaced kind.
    expect(card.textContent).toContain("Migration");
  });

  it("says so explicitly when the snapshot carries no elements", () => {
    render(
      <TranscriptExtensionSnapshotRow
        entry={snapshotEntry({
          state: {
            agentId: "agent-1",
            revision: 4,
            updatedAt: "2026-01-01T00:00:00.000Z",
            elements: [],
          },
        })}
        testId="snap-empty"
      />,
    );
    expect(screen.getByTestId("snap-empty").textContent).toContain("no elements");
  });

  it("bounds a huge snapshot rather than listing it whole", () => {
    const elements = Array.from({ length: 60 }, (_, index) => ({
      id: `el-${index}`,
      ns: "loop",
      kind: "status",
      placement: "rail",
      payload: { kind: "status", text: `item ${index}` },
    }));
    render(
      <TranscriptExtensionSnapshotRow
        entry={snapshotEntry({
          state: {
            agentId: "agent-1",
            revision: 5,
            updatedAt: "2026-01-01T00:00:00.000Z",
            elements,
          },
        })}
        testId="snap-many"
      />,
    );
    const card = screen.getByTestId("snap-many");
    expect(card.textContent).toContain("60 elements");
    expect(card.textContent).toContain("more elements not shown");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <TranscriptExtensionSnapshotRow entry={snapshotEntry()} testId="snap-axe" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
