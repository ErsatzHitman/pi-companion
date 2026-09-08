import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";

import type { PickedFile } from "@picompanion/frontend-core";

import { filesFromDataTransfer } from "./browser-file-inputs.js";

export interface UseDragAndDropOptions {
  /** Every dropped file, converted to `PickedFile` — pass this straight to `useAttachments.addFiles`. */
  onFiles: (files: readonly PickedFile[]) => void;
}

export interface DropZoneHandlers {
  onDragEnter: (event: ReactDragEvent<HTMLElement>) => void;
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLElement>) => void;
}

export interface UseDragAndDropState {
  /**
   * `true` only while a file drag is actually over the drop target — the
   * "quiet until a drag is actually over the target" affordance (T279).
   * Never latches on for any other reason, so the composer never shows a
   * permanent dashed rectangle.
   */
  isDraggingOver: boolean;
  /** Spread onto the element that should act as the drop target. */
  dropZoneHandlers: DropZoneHandlers;
}

/** `true` only when the drag actually carries files (never a text/DOM-node drag from elsewhere on the page). */
function carriesFiles(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes("Files"));
}

/**
 * Drag-and-drop for the composer (T279). Two independent jobs, because
 * the acceptance criteria ask for two independent guarantees:
 *
 * 1. **A drop outside the target must not navigate.** Without
 *    `preventDefault()` on `dragover`/`drop`, dropping a file ANYWHERE in
 *    the document (not just over this composer) makes the browser
 *    navigate the tab to that local file and the drop is lost — this is
 *    the browser's native behavior for an un-handled file drop, not a
 *    bug in this app. A `window`-level listener pair, added on mount and
 *    removed on unmount, calls `preventDefault()` on any file-carrying
 *    drag anywhere on the page; it never stages a file itself, only
 *    stops the navigation, so a drop away from the real target is simply
 *    swallowed rather than lost to a navigation.
 * 2. **The drop target itself** is `dropZoneHandlers`, meant to be spread
 *    onto one element (the composer's own wrapper — deliberately not
 *    `window`, per the brief's "needs a drop target that is not the
 *    whole window unless you mean it"). `isDraggingOver` tracks drag
 *    depth rather than a plain boolean, because `dragenter`/`dragleave`
 *    fire once per DOM element the pointer crosses while dragging (every
 *    child inside the target, not just the target itself) — a plain
 *    "set true on enter, false on leave" flicker false the instant the
 *    drag crosses from the wrapper onto a child element inside it.
 *
 * `onDrop` hands every dropped `PickedFile` to `onFiles` — in practice
 * `useAttachments.addFiles`, the exact same staging/size-ceiling/upload
 * path `pickAndAddFiles` uses, so a dropped 200 MB file is rejected by
 * the same rule as a picked one (T279's "one acceptance path" bar).
 */
export function useDragAndDrop(options: UseDragAndDropOptions): UseDragAndDropState {
  const { onFiles } = options;
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    function preventNavigation(event: DragEvent): void {
      if (carriesFiles(event.dataTransfer)) event.preventDefault();
    }
    window.addEventListener("dragover", preventNavigation);
    window.addEventListener("drop", preventNavigation);
    return () => {
      window.removeEventListener("dragover", preventNavigation);
      window.removeEventListener("drop", preventNavigation);
    };
  }, []);

  const onDragEnter = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingOver(true);
  }, []);

  const onDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Required on every `dragover`, not only `dragenter` — a browser only
    // allows a `drop` to fire on a target whose `dragover` calls this.
    event.preventDefault();
  }, []);

  const onDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingOver(false);
  }, []);

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingOver(false);
      const files = filesFromDataTransfer(event.dataTransfer);
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );

  return {
    isDraggingOver,
    dropZoneHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
