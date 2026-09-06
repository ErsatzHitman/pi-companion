import { describe, expect, it } from "vitest";

import type { Clock, TimerHandle } from "../platform/clock.js";
import { ToolCallViewModelRegistry } from "./registry.js";
import type {
  EditToolCallViewModel,
  GenericToolCallViewModel,
  SearchToolCallViewModel,
} from "./types.js";
import {
  DETAIL_UNKNOWN,
  EDIT_MULTI_COMPLETED,
  EDIT_MULTI_RUNNING,
  SEARCH_FAILED,
  SEARCH_PARTIAL,
  SEARCH_PARTIAL_MORE,
  SEARCH_RUNNING,
} from "./__fixtures__/tool-call-timeline-items.js";

/** Deterministic fake clock: every call to `now()` returns the next value
 * from a queue, defaulting to the last value once exhausted. */
class FakeClock implements Clock {
  private index = 0;
  constructor(private readonly ticks: number[]) {}
  now(): number {
    const value = this.ticks[Math.min(this.index, this.ticks.length - 1)];
    this.index += 1;
    return value;
  }
  setTimeout(): TimerHandle {
    throw new Error("not used in these tests");
  }
  clearTimeout(): void {}
  setInterval(): TimerHandle {
    throw new Error("not used in these tests");
  }
  clearInterval(): void {}
}

describe("ToolCallViewModelRegistry — streaming updates stay attached to their call", () => {
  it("keeps one entry per callId across running -> partial -> partial -> failed", () => {
    const registry = new ToolCallViewModelRegistry(new FakeClock([1000, 1050, 1120, 1200]));

    const first = registry.upsert(SEARCH_RUNNING) as SearchToolCallViewModel;
    expect(first.callId).toBe("call-synthetic-0003");
    expect(first.status).toBe("running");
    expect(first.startedAt).toBe(1000);
    expect(first.updatedAt).toBe(1000);
    expect(first.updateCount).toBe(1);
    expect(registry.size).toBe(1);

    const second = registry.upsert(SEARCH_PARTIAL) as SearchToolCallViewModel;
    expect(second.callId).toBe(first.callId);
    expect(second.numMatches).toBe(1);
    expect(second.startedAt).toBe(1000); // preserved from the first observation
    expect(second.updatedAt).toBe(1050);
    expect(second.updateCount).toBe(2);
    expect(registry.size).toBe(1); // still one entry, not a duplicate

    const third = registry.upsert(SEARCH_PARTIAL_MORE) as SearchToolCallViewModel;
    expect(third.numMatches).toBe(2);
    expect(third.updateCount).toBe(3);

    const final = registry.upsert(SEARCH_FAILED) as SearchToolCallViewModel;
    expect(final.status).toBe("failed");
    expect(final.startedAt).toBe(1000);
    expect(final.updatedAt).toBe(1200);
    expect(final.durationMs).toBe(200);
    expect(final.updateCount).toBe(4);
    expect(registry.size).toBe(1);

    expect(registry.get("call-synthetic-0003")).toEqual(final);
  });

  it("tracks independent calls under independent entries", () => {
    const registry = new ToolCallViewModelRegistry(new FakeClock([0, 1, 2, 3]));
    registry.upsert(SEARCH_RUNNING);
    registry.upsert(EDIT_MULTI_RUNNING);
    expect(registry.size).toBe(2);
    registry.upsert(EDIT_MULTI_COMPLETED);
    expect(registry.size).toBe(2);
    const edit = registry.get("call-synthetic-0002") as EditToolCallViewModel;
    expect(edit.status).toBe("completed");
    expect(edit.updateCount).toBe(2);
  });

  it("keeps an unknown-detail call attached across updates without throwing", () => {
    const registry = new ToolCallViewModelRegistry(new FakeClock([10, 20]));
    const first = registry.upsert(DETAIL_UNKNOWN) as GenericToolCallViewModel;
    expect(first.family).toBe("generic");
    const second = registry.upsert(DETAIL_UNKNOWN) as GenericToolCallViewModel;
    expect(second.callId).toBe(first.callId);
    expect(second.updateCount).toBe(2);
    expect(registry.size).toBe(1);
  });

  it("removes and clears entries", () => {
    const registry = new ToolCallViewModelRegistry(new FakeClock([0]));
    registry.upsert(SEARCH_RUNNING);
    expect(registry.has("call-synthetic-0003")).toBe(true);
    registry.remove("call-synthetic-0003");
    expect(registry.has("call-synthetic-0003")).toBe(false);

    registry.upsert(SEARCH_RUNNING);
    registry.upsert(EDIT_MULTI_RUNNING);
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
  });

  it("supports an explicit blockedByPermissionRequestId per upsert", () => {
    const registry = new ToolCallViewModelRegistry(new FakeClock([0, 1]));
    registry.upsert(SEARCH_RUNNING);
    const blocked = registry.upsert(SEARCH_PARTIAL, {
      blockedByPermissionRequestId: "perm-req-0042",
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockedByPermissionRequestId).toBe("perm-req-0042");
  });
});
