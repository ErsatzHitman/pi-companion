import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDragAndDrop } from "./use-drag-and-drop.js";

// Each test below mounts its own `useDragAndDrop`, which adds real
// `window`-level `dragover`/`drop` listeners (see that hook's own doc
// comment) — without unmounting between tests, an EARLIER test's
// still-mounted hook would keep intercepting a LATER test's `dispatchEvent`
// calls, exactly the failure mode this suite's own "removes its
// window-level listeners on unmount" test exists to catch.
afterEach(cleanup);

/** Minimal `ReactDragEvent`-shaped stub — enough for this hook's own logic, without a real DOM drag. */
function dragEvent(types: string[] = ["Files"]) {
  return {
    dataTransfer: { types, files: [] as File[] },
    preventDefault: vi.fn(),
  } as unknown as React.DragEvent<HTMLElement>;
}

function makeFile(name: string): File {
  return new File(["x"], name, { type: "image/png" });
}

describe("useDragAndDrop", () => {
  it("starts with isDraggingOver false", () => {
    const { result } = renderHook(() => useDragAndDrop({ onFiles: () => {} }));
    expect(result.current.isDraggingOver).toBe(false);
  });

  it("sets isDraggingOver on dragenter and prevents the default navigation", () => {
    const { result } = renderHook(() => useDragAndDrop({ onFiles: () => {} }));
    const event = dragEvent();

    act(() => result.current.dropZoneHandlers.onDragEnter(event));

    expect(result.current.isDraggingOver).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("ignores a drag that carries no files (e.g. dragging selected text)", () => {
    const { result } = renderHook(() => useDragAndDrop({ onFiles: () => {} }));
    const event = dragEvent([]);

    act(() => result.current.dropZoneHandlers.onDragEnter(event));

    expect(result.current.isDraggingOver).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("stays dragging-over across a dragenter into a nested child before leaving the outer element (depth counting)", () => {
    const { result } = renderHook(() => useDragAndDrop({ onFiles: () => {} }));

    // Enter the wrapper, then enter a child inside it (two dragenter events,
    // as the real DOM fires for nested elements), then leave the child.
    act(() => result.current.dropZoneHandlers.onDragEnter(dragEvent()));
    act(() => result.current.dropZoneHandlers.onDragEnter(dragEvent()));
    act(() => result.current.dropZoneHandlers.onDragLeave(dragEvent()));

    // Still "over" — only one of the two enters has been balanced by a leave.
    expect(result.current.isDraggingOver).toBe(true);

    act(() => result.current.dropZoneHandlers.onDragLeave(dragEvent()));
    expect(result.current.isDraggingOver).toBe(false);
  });

  it("onDragOver keeps preventing default so the browser allows a drop", () => {
    const { result } = renderHook(() => useDragAndDrop({ onFiles: () => {} }));
    const event = dragEvent();
    act(() => result.current.dropZoneHandlers.onDragOver(event));
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("onDrop resets isDraggingOver, prevents default, and hands files to onFiles", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useDragAndDrop({ onFiles }));

    act(() => result.current.dropZoneHandlers.onDragEnter(dragEvent()));
    expect(result.current.isDraggingOver).toBe(true);

    const file = makeFile("dropped.png");
    const dropEvt = {
      dataTransfer: { types: ["Files"], files: [file] },
      preventDefault: vi.fn(),
    } as unknown as React.DragEvent<HTMLElement>;

    act(() => result.current.dropZoneHandlers.onDrop(dropEvt));

    expect(dropEvt.preventDefault).toHaveBeenCalled();
    expect(result.current.isDraggingOver).toBe(false);
    expect(onFiles).toHaveBeenCalledTimes(1);
    const [passedFiles] = onFiles.mock.calls[0];
    expect(passedFiles).toHaveLength(1);
    expect(passedFiles[0].name).toBe("dropped.png");
  });

  it("does not call onFiles when a drop carries no files", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useDragAndDrop({ onFiles }));
    act(() => result.current.dropZoneHandlers.onDrop(dragEvent([])));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("prevents the browser's default navigation for a file drop anywhere on the page, not only over the drop target", () => {
    renderHook(() => useDragAndDrop({ onFiles: () => {} }));

    const event = new Event("drop", { cancelable: true, bubbles: true });
    Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"] } });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("does not intercept a non-file drag at the window level (e.g. reordering elements within the page)", () => {
    renderHook(() => useDragAndDrop({ onFiles: () => {} }));

    const event = new Event("drop", { cancelable: true, bubbles: true });
    Object.defineProperty(event, "dataTransfer", { value: { types: ["text/plain"] } });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("removes its window-level listeners on unmount", () => {
    const { unmount } = renderHook(() => useDragAndDrop({ onFiles: () => {} }));
    unmount();

    const event = new Event("drop", { cancelable: true, bubbles: true });
    Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"] } });
    window.dispatchEvent(event);

    // No listener left to prevent it once unmounted.
    expect(event.defaultPrevented).toBe(false);
  });
});
