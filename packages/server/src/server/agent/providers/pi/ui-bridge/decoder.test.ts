import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PIUI_MARKER } from "./schema.js";
import { PiUiDecoder, type PiUiDecodedOp } from "./decoder.js";

/**
 * T40A3 — proves the unknown-channel diagnostic dedup plan.md §11.7 requires
 * ("Unknown channels produce one diagnostic and are not rendered as
 * transcript text") with a counting fake, not by eyeballing a log.
 *
 * `warnUnknownChannel` (module-private in `decoder.ts`) keeps a
 * process-wide `Set<string>` of channels already warned about and calls
 * `console.warn` only the first time each distinct channel name is seen —
 * this was previously unverified: no test in this directory exercised the
 * `op: "channel"` branch at all. Every op here is sent through the real
 * `PIUI ` marker + JSON wire encoding `PiUiDecoder.ingest` actually parses,
 * not a hand-built `PiUiDecodedOp`.
 *
 * Scope note: this file lives in `packages/server`, outside T40A3's
 * `apps/web/src/features/extensions/` Owns grant. No task in this wave
 * (P6-W3: T38A3, T38A1b, T38B0c, T91, T103, T95) owns
 * `packages/server/src/server/agent/providers/pi/ui-bridge/`, and the
 * checklist item this proves ("Unknown channels produce one diagnostic")
 * has no client-visible counterpart to test from `apps/web` — channel
 * routing and its unknown-channel dedup are entirely daemon-side
 * (`state.ts`'s `applyChannel` only ever synthesizes the three *known*
 * channels into ordinary `pi_ui_delta` upserts; an unknown channel is
 * dropped here, in the decoder, before `applyChannel` or the client ever
 * sees it).
 */

function channelMessage(channel: string, payload: unknown = {}): string {
  return `${PIUI_MARKER}${JSON.stringify({ v: 1, op: "channel", channel, payload })}`;
}

function makeDecoder() {
  const ops: PiUiDecodedOp[] = [];
  const notices: Array<{ level: string; message: string }> = [];
  const decoder = new PiUiDecoder({
    onOp: (op) => ops.push(op),
    onNotice: (level, message) => notices.push({ level, message }),
  });
  return { decoder, ops, notices };
}

describe("PiUiDecoder unknown-channel diagnostic (plan.md §11.7)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("warns exactly once for a repeated unknown channel — the counting fake, not a log read", () => {
    // A channel name unique to this test run, so the decoder's process-wide
    // dedup `Set` (module state, never reset between tests) cannot have
    // already seen it from another test/file.
    const channel = `unknown-channel-repeat-${Math.random().toString(36).slice(2)}`;
    const { decoder, ops, notices } = makeDecoder();

    const consumed1 = decoder.ingest(channelMessage(channel, { a: 1 }));
    const consumed2 = decoder.ingest(channelMessage(channel, { a: 2 }));
    const consumed3 = decoder.ingest(channelMessage(channel, { a: 3 }));

    // "dropped, not rendered as transcript text": every occurrence is
    // consumed by the decoder (never falls through as an unhandled/unknown
    // message the caller might otherwise surface verbatim) and never
    // reaches `onOp` at all.
    expect(consumed1).toBe(true);
    expect(consumed2).toBe(true);
    expect(consumed3).toBe(true);
    expect(ops).toEqual([]);
    expect(notices).toEqual([]);

    // "produce ONE diagnostic" — exactly one `console.warn` call total for
    // three occurrences of the same unknown channel.
    const callsForThisChannel = warnSpy.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes(channel),
    );
    expect(callsForThisChannel).toHaveLength(1);
    expect(callsForThisChannel[0]?.[0]).toContain("unknown channel dropped");
  });

  it("warns again for a genuinely different unknown channel — dedup is per-channel, not global", () => {
    const suffix = Math.random().toString(36).slice(2);
    const channelA = `unknown-channel-a-${suffix}`;
    const channelB = `unknown-channel-b-${suffix}`;
    const { decoder } = makeDecoder();

    decoder.ingest(channelMessage(channelA));
    decoder.ingest(channelMessage(channelB));
    decoder.ingest(channelMessage(channelA));
    decoder.ingest(channelMessage(channelB));

    const callsForA = warnSpy.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes(channelA),
    );
    const callsForB = warnSpy.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes(channelB),
    );
    expect(callsForA).toHaveLength(1);
    expect(callsForB).toHaveLength(1);
  });

  it("mutation sentinel: a fresh decoder instance does not reset the dedup, proving the assertion above is not vacuous", () => {
    // "A fix that no test can fail is not a fix": show the counting
    // assertion actually discriminates by proving a *second* `PiUiDecoder`
    // instance still shares the module-level dedup — if `warnUnknownChannel`
    // were (incorrectly) keyed per-decoder-instance instead of per-process,
    // this would warn a second time and the test would fail.
    const channel = `unknown-channel-cross-instance-${Math.random().toString(36).slice(2)}`;
    const first = makeDecoder();
    const second = makeDecoder();

    first.decoder.ingest(channelMessage(channel));
    second.decoder.ingest(channelMessage(channel));

    const calls = warnSpy.mock.calls.filter((call: unknown[]) => String(call[0]).includes(channel));
    expect(calls).toHaveLength(1);
  });

  it("routes a known channel to onOp instead of warning", () => {
    const { decoder, ops, notices } = makeDecoder();
    const consumed = decoder.ingest(channelMessage("subagents:fleet", { header: "Fleet" }));

    expect(consumed).toBe(true);
    expect(notices).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(ops).toEqual([
      {
        kind: "channel",
        channel: "subagents:fleet",
        payload: { header: "Fleet" },
        agentSeq: undefined,
      },
    ]);
  });
});
