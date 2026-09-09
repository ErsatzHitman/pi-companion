/**
 * Message timestamp presentation — plan.md §7.4 (preserved daemon
 * timestamps) and §11.1 (transcript rows).
 *
 * `TranscriptEntry.timestamp` (see `./transcript-view.ts`) already carries
 * the daemon's own timestamp verbatim on every entry, so both apps have had
 * the data to show when a message happened since T28A1 — neither displayed
 * it. This module owns the one decision they now share: how that ISO string
 * becomes a short human label. It lives here rather than in either app
 * because the answer is framework-neutral and must not diverge between web
 * and Android; the two `message-row` files do nothing but render what this
 * returns.
 *
 * Two properties this module is deliberately built around:
 *
 * 1. **Local time by default, injectable for tests.** A user reading a
 *    transcript wants their own wall clock, so `timeZone` defaults to the
 *    host's. That makes naive tests machine-dependent, which is why
 *    `timeZone` and `locale` are accepted as overrides rather than pinned
 *    to UTC the way `apps/web/src/features/files/format.ts`'s
 *    `formatModifiedAt` pins them. Pinning would have been the cheaper
 *    choice and the wrong one: a message sent at 17:42 IST would render as
 *    "12:12" to the person who sent it.
 * 2. **Never throws, never renders garbage.** An unparseable or absent
 *    timestamp returns `null` and the row shows nothing, rather than
 *    "Invalid Date" — the same "degrade, do not fabricate" stance
 *    `transcript-view.ts` takes with its `"unknown"` entry kind. A hostile
 *    or simply unsupported `timeZone`/`locale` is caught and retried
 *    without it, because `Intl` throws a `RangeError` on both and a
 *    timestamp is never worth a blank transcript.
 *
 * Repository invariant: this module must never import React, React Native,
 * Expo, DOM types, or browser globals. It uses only `Intl` and `Date`,
 * both of which are ECMA-262/ECMA-402 language built-ins available in
 * Node, browsers, and Hermes alike.
 */

export interface MessageTimestampOptions {
  /**
   * Reference instant used to decide whether the message is from today, and
   * therefore whether the label needs a date at all. Defaults to the
   * current time. Tests pass an explicit value so the same-day branch is
   * reachable deterministically.
   */
  readonly now?: Date;
  /**
   * IANA time zone the label is rendered in. Defaults to the host's zone,
   * which is what a reader wants. An unsupported value falls back to the
   * host's zone rather than throwing.
   */
  readonly timeZone?: string;
  /**
   * BCP 47 locale for the label. Defaults to the host's, so a 12-hour
   * locale gets "5:42:08 PM" and a 24-hour one "17:42:08" without this
   * module choosing for them.
   */
  readonly locale?: string;
}

export interface MessageTimestampLabel {
  /**
   * Short label for display next to the message: the time alone when the
   * message is from today, widening to include the date, and then the year,
   * only when it must to stay unambiguous.
   */
  readonly text: string;
  /**
   * The parsed instant re-serialised as ISO 8601 UTC, for a `<time
   * dateTime>` attribute or any other machine-readable use. Derived from
   * the parsed date rather than passed through, so it is always a valid
   * ISO string even when the input was a looser format `Date` accepted.
   */
  readonly iso: string;
  /**
   * Always-complete label — full date, time, and zone name — for a tooltip
   * and for the accessible name. `text` is short by design and drops
   * information a reader may still need; this never does.
   */
  readonly title: string;
}

/**
 * Calendar-day key for `date` as observed in `timeZone`.
 *
 * Comparing days has to happen in the display zone, not the host's: a
 * message sent at 23:30 IST is "yesterday" to a reader in IST and "today"
 * to one in UTC, and only the display zone's answer matches the label the
 * reader is about to see. `en-US` is hardcoded here on purpose — this
 * string is a comparison key that never reaches a user, so the caller's
 * `locale` must not be able to change how two days compare.
 */
function dayKey(date: Date, timeZone: string | undefined): string {
  const parts = formatParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatParts(date: Date, timeZone: string | undefined): Record<string, string> {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  const parts = withZone(
    (zone) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone }).formatToParts(date),
    timeZone,
  );
  const result: Record<string, string> = {};
  for (const part of parts) {
    result[part.type] = part.value;
  }
  return result;
}

/**
 * Runs `build` with `timeZone`, retrying without it if `Intl` rejects the
 * value. `Intl` throws `RangeError` for an unknown IANA zone or a
 * malformed locale, and a timestamp label is never worth propagating that
 * to a renderer — the host's own zone is always a valid answer.
 */
function withZone<T>(build: (timeZone: string | undefined) => T, timeZone: string | undefined): T {
  if (timeZone === undefined) return build(undefined);
  try {
    return build(timeZone);
  } catch {
    return build(undefined);
  }
}

function format(
  date: Date,
  options: Intl.DateTimeFormatOptions,
  locale: string | undefined,
  timeZone: string | undefined,
): string {
  return withZone((zone) => {
    try {
      return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(date);
    } catch {
      // A malformed `locale` throws the same way a bad zone does; the host
      // default is again always valid.
      return new Intl.DateTimeFormat(undefined, { ...options, timeZone: zone }).format(date);
    }
  }, timeZone);
}

/**
 * Formats one message's daemon timestamp for display beneath the message.
 *
 * Returns `null` — meaning "render no timestamp" — when `iso` is absent,
 * empty, or not a date any `Date` parse accepts. Callers are expected to
 * treat that as "omit the element", not as an error worth surfacing: a row
 * that cannot be dated is still a row worth reading.
 */
export function formatMessageTimestamp(
  iso: string | undefined,
  options: MessageTimestampOptions = {},
): MessageTimestampLabel | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const { now = new Date(), timeZone, locale } = options;

  const time = format(date, { timeStyle: "medium" }, locale, timeZone);

  // Widen the label only as far as ambiguity requires: today needs no date,
  // an earlier day this year needs a day and month, and an earlier year
  // needs the year too. A transcript is read top to bottom, so most rows
  // are same-day and carrying a full date on each one would be noise that
  // pushes the part a reader is scanning for off to the right.
  const reference = Number.isNaN(now.getTime()) ? new Date() : now;
  const sameDay = dayKey(date, timeZone) === dayKey(reference, timeZone);
  const sameYear = formatParts(date, timeZone).year === formatParts(reference, timeZone).year;

  let text: string;
  if (sameDay) {
    text = time;
  } else if (sameYear) {
    text = `${format(date, { month: "short", day: "numeric" }, locale, timeZone)}, ${time}`;
  } else {
    text = `${format(date, { year: "numeric", month: "short", day: "numeric" }, locale, timeZone)}, ${time}`;
  }

  return {
    text,
    iso: date.toISOString(),
    title: format(date, { dateStyle: "full", timeStyle: "long" }, locale, timeZone),
  };
}
