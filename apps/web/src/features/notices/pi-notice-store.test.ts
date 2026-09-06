import { describe, expect, it } from "vitest";

import { PiNoticeStore } from "./pi-notice-store.js";
import type { PiNoticeSourceEvent } from "./pi-notice-store.js";

function notice(partial: Partial<PiNoticeSourceEvent> = {}): PiNoticeSourceEvent {
  return {
    type: "pi_notice",
    provider: "pi",
    level: "info",
    message: "test notice",
    ...partial,
  } as PiNoticeSourceEvent;
}

describe("PiNoticeStore", () => {
  it("starts empty", () => {
    const store = new PiNoticeStore();
    expect(store.getSnapshot()).toEqual([]);
  });

  it("ingests a notice and carries its fields through", () => {
    const store = new PiNoticeStore();
    store.ingest(notice({ level: "warning", message: "resync requested", source: "ui-bridge" }));

    const [entry] = store.getSnapshot();
    expect(entry).toMatchObject({
      level: "warning",
      message: "resync requested",
      provider: "pi",
      source: "ui-bridge",
    });
    expect(entry?.id).toBeTruthy();
  });

  it("appends in order, oldest first", () => {
    const store = new PiNoticeStore();
    store.ingest(notice({ message: "first" }));
    store.ingest(notice({ message: "second" }));

    expect(store.getSnapshot().map((entry) => entry.message)).toEqual(["first", "second"]);
  });

  it("caps at 20 entries, dropping the oldest", () => {
    const store = new PiNoticeStore();
    for (let i = 0; i < 25; i += 1) {
      store.ingest(notice({ message: `notice ${i}` }));
    }

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(20);
    expect(snapshot[0]?.message).toBe("notice 5");
    expect(snapshot[19]?.message).toBe("notice 24");
  });

  it("returns the same array reference until the next mutation", () => {
    const store = new PiNoticeStore();
    store.ingest(notice());
    const first = store.getSnapshot();
    const second = store.getSnapshot();
    expect(first).toBe(second);

    store.ingest(notice({ message: "another" }));
    expect(store.getSnapshot()).not.toBe(first);
  });

  it("dismisses a notice by id", () => {
    const store = new PiNoticeStore();
    store.ingest(notice({ message: "keep me" }));
    store.ingest(notice({ message: "dismiss me" }));

    const [, second] = store.getSnapshot();
    store.dismiss(second!.id);

    expect(store.getSnapshot().map((entry) => entry.message)).toEqual(["keep me"]);
  });

  it("dismissing an unknown id is a no-op that does not notify", () => {
    const store = new PiNoticeStore();
    store.ingest(notice());
    const before = store.getSnapshot();

    let notified = false;
    store.subscribe(() => {
      notified = true;
    });
    store.dismiss("not-a-real-id");

    expect(store.getSnapshot()).toBe(before);
    expect(notified).toBe(false);
  });

  it("notifies subscribers on ingest and dismiss", () => {
    const store = new PiNoticeStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.ingest(notice());
    expect(notifications).toBe(1);

    const [entry] = store.getSnapshot();
    store.dismiss(entry!.id);
    expect(notifications).toBe(2);

    unsubscribe();
    store.ingest(notice());
    expect(notifications).toBe(2);
  });
});
