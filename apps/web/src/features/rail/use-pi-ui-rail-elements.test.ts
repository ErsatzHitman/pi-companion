import { extensions } from "@picompanion/frontend-core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePiUiRailElements } from "./use-pi-ui-rail-elements.js";

const { PiUiElementStore } = extensions;

describe("usePiUiRailElements", () => {
  it("reads the store's current elements for one agent", () => {
    const store = new PiUiElementStore();
    store.ingestDelta("agt_1", 1, {
      op: "upsert",
      element: { id: "tasks", ns: "todo", kind: "widget", placement: "pinned", title: "Tasks" },
    });

    const { result } = renderHook(() => usePiUiRailElements(store, "agt_1"));
    expect(result.current.map((el) => el.id)).toEqual(["tasks"]);
  });

  it("returns an empty array for an agent the store has never seen", () => {
    const store = new PiUiElementStore();
    const { result } = renderHook(() => usePiUiRailElements(store, "agt_unknown"));
    expect(result.current).toEqual([]);
  });

  it("updates live when the store ingests a new delta for the subscribed agent", () => {
    const store = new PiUiElementStore();
    const { result } = renderHook(() => usePiUiRailElements(store, "agt_1"));
    expect(result.current).toEqual([]);

    act(() => {
      store.ingestDelta("agt_1", 1, {
        op: "upsert",
        element: { id: "tasks", ns: "todo", kind: "widget", placement: "pinned", title: "Tasks" },
      });
    });

    expect(result.current.map((el) => el.id)).toEqual(["tasks"]);
  });

  it("ignores deltas for a different agent", () => {
    const store = new PiUiElementStore();
    const { result } = renderHook(() => usePiUiRailElements(store, "agt_1"));

    act(() => {
      store.ingestDelta("agt_2", 1, {
        op: "upsert",
        element: { id: "tasks", ns: "todo", kind: "widget", placement: "pinned", title: "Tasks" },
      });
    });

    expect(result.current).toEqual([]);
  });

  it("returns a referentially stable snapshot across re-renders when the revision has not changed", () => {
    const store = new PiUiElementStore();
    store.ingestDelta("agt_1", 1, {
      op: "upsert",
      element: { id: "tasks", ns: "todo", kind: "widget", placement: "pinned", title: "Tasks" },
    });

    const { result, rerender } = renderHook(() => usePiUiRailElements(store, "agt_1"));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
