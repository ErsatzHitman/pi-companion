import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";

import { MessageAttachments } from "./message-attachments.js";
import type { ResolveImageSrc } from "./message-attachments.js";

afterEach(cleanup);

function image(overrides: Partial<AgentTimelineImageRef> = {}): AgentTimelineImageRef {
  return {
    mimeType: "image/png",
    path: "/tmp/paseo-attachments-abc123/deadbeef.png",
    bytes: 42_000,
    ...overrides,
  };
}

describe("MessageAttachments", () => {
  it("renders nothing for an entry with no images", () => {
    const { container } = render(
      <MessageAttachments images={[]} entryId="row-1" speaker="user" testId="row-1-attachments" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("gives each image a meaningful accessible name instead of a filename alone", () => {
    render(
      <MessageAttachments
        images={[image()]}
        entryId="row-1"
        speaker="user"
        testId="row-1-attachments"
      />,
    );
    // The name never contains the daemon-local temp path.
    const group = screen.getByTestId("row-1-attachments");
    expect(group.textContent).not.toContain("deadbeef.png");
    expect(group.textContent).not.toContain("/tmp/");
    // It does carry who attached it, the image kind, and the size.
    expect(screen.getByText(/You attached an image: PNG image, 41 KB/)).toBeTruthy();
  });

  it("numbers each image's position when a message carries more than one", () => {
    render(
      <MessageAttachments
        images={[image({ mimeType: "image/png" }), image({ mimeType: "image/jpeg" })]}
        entryId="row-2"
        speaker="assistant"
        testId="row-2-attachments"
      />,
    );
    expect(screen.getByText(/Pi attached an image \(1 of 2\): PNG image/)).toBeTruthy();
    expect(screen.getByText(/Pi attached an image \(2 of 2\): JPEG image/)).toBeTruthy();
  });

  it("bounds the number of images rendered per message and says how many were hidden", () => {
    const images = Array.from({ length: 15 }, (_, index) =>
      image({ path: `/tmp/paseo-attachments-abc/${index}.png` }),
    );
    render(
      <MessageAttachments
        images={images}
        entryId="row-3"
        speaker="user"
        testId="row-3-attachments"
      />,
    );
    expect(screen.getByText("3 more images not shown")).toBeTruthy();
  });

  it("renders a real, keyboard-reachable image when the caller can resolve one", async () => {
    const resolveImageSrc: ResolveImageSrc = () => "https://daemon.example/attachment.png";
    render(
      <MessageAttachments
        images={[image()]}
        entryId="row-4"
        speaker="user"
        resolveImageSrc={resolveImageSrc}
        testId="row-4-attachments"
      />,
    );
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("https://daemon.example/attachment.png");
    expect(img.getAttribute("alt")).toContain("PNG image");

    const link = screen.getByRole("link");
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(link);
  });

  it("passes the source image and message context to the resolver", () => {
    const resolveImageSrc = vi.fn<ResolveImageSrc>().mockReturnValue(undefined);
    const theImage = image({ mimeType: "image/webp" });
    render(
      <MessageAttachments
        images={[theImage]}
        entryId="row-5"
        speaker="assistant"
        resolveImageSrc={resolveImageSrc}
      />,
    );
    expect(resolveImageSrc).toHaveBeenCalledWith(theImage, {
      entryId: "row-5",
      speaker: "assistant",
      index: 0,
      total: 1,
    });
  });

  it("falls back to a keyboard-reachable reference card when no resolver is supplied", async () => {
    render(
      <MessageAttachments
        images={[image()]}
        entryId="row-6"
        speaker="user"
        testId="row-6-attachments"
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();

    const disclosure = document.querySelector("details.pc-message-attachment--reference");
    expect(disclosure).toBeTruthy();
    const summary = within(disclosure as HTMLElement).getByText(/You attached an image/);
    expect(summary.closest("summary")).toBeTruthy();

    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(summary.closest("summary"));

    expect(
      screen.getByText("A preview isn't available for this image in this client yet."),
    ).toBeTruthy();
  });

  it("bounds an oversized image with a visible note instead of rendering it, even when resolvable", () => {
    const resolveImageSrc: ResolveImageSrc = () => "https://daemon.example/huge.png";
    render(
      <MessageAttachments
        images={[image({ bytes: 5_000_000 })]}
        entryId="row-7"
        speaker="user"
        resolveImageSrc={resolveImageSrc}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/exceeds the 1\.9 MB preview limit/)).toBeTruthy();
  });

  it("shows type and size on the reference card for an unresolved image", () => {
    render(
      <MessageAttachments
        images={[image({ mimeType: "image/jpeg", bytes: 2048 })]}
        entryId="row-8"
        speaker="user"
      />,
    );
    expect(screen.getByText("JPEG image · 2.0 KB")).toBeTruthy();
  });

  it("labels the group with how many images the speaker attached", () => {
    render(
      <MessageAttachments
        images={[image(), image()]}
        entryId="row-9"
        speaker="assistant"
        testId="row-9-attachments"
      />,
    );
    expect(screen.getByRole("group", { name: "Pi attached 2 images" })).toBeTruthy();
  });
});

describe("MessageAttachments — accessibility", () => {
  it("has no axe violations for a message carrying a resolvable image and an unresolved one", async () => {
    const resolveImageSrc: ResolveImageSrc = (theImage) =>
      theImage.mimeType === "image/png" ? "https://daemon.example/one.png" : undefined;
    const { container } = render(
      <MessageAttachments
        images={[image({ mimeType: "image/png" }), image({ mimeType: "image/jpeg" })]}
        entryId="row-axe"
        speaker="user"
        resolveImageSrc={resolveImageSrc}
        testId="row-axe-attachments"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
