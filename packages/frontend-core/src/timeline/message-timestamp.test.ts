import { describe, expect, it } from "vitest";

import { formatMessageTimestamp } from "./message-timestamp.js";

/**
 * Every test here pins `timeZone` and `locale` explicitly. That is not
 * ceremony: the module deliberately defaults to the HOST's zone and locale
 * (see its module doc for why UTC would be the wrong default for a
 * user-facing clock), so a test that omitted them would pass or fail
 * depending on which machine ran it — the exact class of Windows-vs-CI
 * disagreement `CLAUDE.md`'s repository-invariants section describes.
 *
 * `Asia/Kolkata` is used as the display zone throughout because its
 * +05:30 offset has a non-zero minutes component, which catches a
 * half-hour-offset bug that a whole-hour zone like `America/New_York`
 * would hide.
 */
const IST = "Asia/Kolkata";
const EN_GB = "en-GB"; // 24-hour, so assertions read as unambiguous digits.

describe("formatMessageTimestamp", () => {
  it("renders the time alone for a message from the same day", () => {
    const label = formatMessageTimestamp("2026-09-09T12:12:08.000Z", {
      now: new Date("2026-09-09T18:00:00.000Z"),
      timeZone: IST,
      locale: EN_GB,
    });

    expect(label?.text).toBe("17:42:08");
  });

  it("renders local time, not UTC", () => {
    const label = formatMessageTimestamp("2026-09-09T12:12:08.000Z", {
      now: new Date("2026-09-09T18:00:00.000Z"),
      timeZone: IST,
      locale: EN_GB,
    });

    // The decisive assertion of the whole module: 12:12 UTC is 17:42 IST,
    // and a reader in IST must see their own wall clock.
    expect(label?.text).not.toContain("12:12");
    expect(label?.text).toContain("17:42");
  });

  it("honours a half-hour zone offset exactly", () => {
    const label = formatMessageTimestamp("2026-09-09T00:00:00.000Z", {
      now: new Date("2026-09-09T18:00:00.000Z"),
      timeZone: IST,
      locale: EN_GB,
    });

    expect(label?.text).toBe("05:30:00");
  });

  it("adds the day and month for an earlier day in the same year", () => {
    const label = formatMessageTimestamp("2026-09-08T12:12:08.000Z", {
      now: new Date("2026-09-09T18:00:00.000Z"),
      timeZone: IST,
      locale: EN_GB,
    });

    // `en-GB` abbreviates September as "Sept" (CLDR 42+), not "Sep" — asserted
    // as the locale actually renders it rather than as it was first guessed.
    expect(label?.text).toBe("8 Sept, 17:42:08");
  });

  it("adds the year as well for a message from an earlier year", () => {
    const label = formatMessageTimestamp("2025-12-31T12:12:08.000Z", {
      now: new Date("2026-09-09T18:00:00.000Z"),
      timeZone: IST,
      locale: EN_GB,
    });

    expect(label?.text).toContain("2025");
    expect(label?.text).toContain("17:42:08");
  });

  it("decides 'same day' in the DISPLAY zone, not UTC", () => {
    // 2026-09-08T19:00Z is 2026-09-09 00:30 IST — already the 9th for a
    // reader in IST, still the 8th in UTC. `now` is later on the 9th IST.
    const label = formatMessageTimestamp("2026-09-08T19:00:00.000Z", {
      now: new Date("2026-09-09T06:00:00.000Z"),
      timeZone: IST,
      locale: EN_GB,
    });

    expect(label?.text).toBe("00:30:00");
  });

  it("treats a late-evening local message as a previous day once the local date rolls over", () => {
    // 2026-09-08T17:00Z is 22:30 IST on the 8th; `now` is 11:30 IST on the
    // 9th. Same UTC-day arithmetic would still say "the 8th vs the 9th"
    // here, but this pins the pairing the previous test inverts.
    const label = formatMessageTimestamp("2026-09-08T17:00:00.000Z", {
      now: new Date("2026-09-09T06:00:00.000Z"),
      timeZone: IST,
      locale: EN_GB,
    });

    expect(label?.text).toBe("8 Sept, 22:30:00");
  });

  it("exposes a machine-readable ISO value derived from the parsed date", () => {
    const label = formatMessageTimestamp("2026-09-09T12:12:08.000Z", {
      now: new Date("2026-09-09T18:00:00.000Z"),
      timeZone: IST,
      locale: EN_GB,
    });

    expect(label?.iso).toBe("2026-09-09T12:12:08.000Z");
  });

  it("normalises a looser accepted date format into a valid ISO value", () => {
    const label = formatMessageTimestamp("2026-09-09T12:12:08Z", {
      now: new Date("2026-09-09T18:00:00.000Z"),
      timeZone: IST,
      locale: EN_GB,
    });

    expect(label?.iso).toBe("2026-09-09T12:12:08.000Z");
  });

  it("always dates the title, even when the short text does not", () => {
    const label = formatMessageTimestamp("2026-09-09T12:12:08.000Z", {
      now: new Date("2026-09-09T18:00:00.000Z"),
      timeZone: IST,
      locale: EN_GB,
    });

    expect(label?.text).toBe("17:42:08");
    // The short label drops the date; the title must not, and must name
    // the zone so a reader can tell which clock they are looking at.
    expect(label?.title).toContain("2026");
    expect(label?.title).toContain("September");
    expect(label?.title).toMatch(/India|GMT\+5:30/);
  });

  it("returns null rather than a fabricated label for an unparseable timestamp", () => {
    for (const bad of ["", "   ", "not a date", "2026-13-45T99:99:99Z"]) {
      expect(formatMessageTimestamp(bad, { timeZone: IST, locale: EN_GB })).toBeNull();
    }
  });

  it("returns null for an absent timestamp", () => {
    expect(formatMessageTimestamp(undefined, { timeZone: IST })).toBeNull();
    // A non-string that reached here through untyped wire data must not throw.
    expect(formatMessageTimestamp(42 as unknown as string, { timeZone: IST })).toBeNull();
  });

  it("falls back to the host zone instead of throwing on an unsupported time zone", () => {
    // `Intl` throws RangeError for this; a bad zone must never blank a row.
    const label = formatMessageTimestamp("2026-09-09T12:12:08.000Z", {
      now: new Date("2026-09-09T18:00:00.000Z"),
      timeZone: "Mars/Olympus_Mons",
      locale: EN_GB,
    });

    expect(label).not.toBeNull();
    expect(label?.iso).toBe("2026-09-09T12:12:08.000Z");
  });

  it("falls back to the host locale instead of throwing on a malformed locale", () => {
    const label = formatMessageTimestamp("2026-09-09T12:12:08.000Z", {
      now: new Date("2026-09-09T18:00:00.000Z"),
      timeZone: IST,
      locale: "not_a_locale!!",
    });

    expect(label).not.toBeNull();
    expect(label?.text).toContain("42");
  });

  it("tolerates an unparseable `now` by falling back to the real clock", () => {
    const label = formatMessageTimestamp("2026-09-09T12:12:08.000Z", {
      now: new Date("nonsense"),
      timeZone: IST,
      locale: EN_GB,
    });

    // The branch it lands in depends on the real clock, so assert only
    // that it produced a usable label rather than throwing or emptying.
    expect(label).not.toBeNull();
    expect(label?.text).toContain("17:42:08");
  });

  it("respects a 12-hour locale rather than forcing 24-hour digits", () => {
    const label = formatMessageTimestamp("2026-09-09T12:12:08.000Z", {
      now: new Date("2026-09-09T18:00:00.000Z"),
      timeZone: IST,
      locale: "en-US",
    });

    expect(label?.text).toMatch(/5:42:08\s?(PM|pm)/);
  });

  it("uses the current time as the reference when `now` is omitted", () => {
    // A message stamped right now must take the same-day branch — the
    // production path, where no caller passes `now`.
    const label = formatMessageTimestamp(new Date().toISOString(), {
      timeZone: IST,
      locale: EN_GB,
    });

    expect(label?.text).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
