// Shared shape for this directory's extension fixtures (T40A1/T40A2).
//
// Deliberately mirrors `../types.ts`'s `FixtureFrame`/`RecordedSessionChapter`
// and `../../timeline/fixtures/types.ts`'s `TimelineFixtureScenario`, so this
// fixture set reads exactly like the other two: a named scenario carrying an
// ordered list of literal wire frames.

export type { FixtureFrame, FixtureFrameDirection } from "../types.js";

import type { FixtureFrame } from "../types.js";

/**
 * One §11.7 UI-bearing extension's canonical payload fixture.
 *
 * `frames` is an ordered list of literal wire frames — element upserts and,
 * where the extension exposes an action, the matching
 * `pi.ui.action.request` / `pi.ui.action.response` / `pi_ui_action_result`
 * triple — in the exact envelope shape `WSOutboundMessageSchema` /
 * `WSInboundMessageSchema` (`@picompanion/protocol/messages`) validate, so a
 * consumer never has to invent a shape.
 */
export interface ExtensionFixtureScenario {
  /** The §11.7 extension name (matches the row in plan.md's bridge-elements table). */
  extension: string;
  description: string;
  planRef: string;
  /**
   * The daemon-synthesized published channel this extension's state travels
   * over (plan.md §11.7: `subagents:fleet`, `workflow:progress`,
   * `pi-goal:status`), when it has one. Purely descriptive — the wire never
   * carries a `"channel"` op to the client; the daemon (`packages/server/
   * src/server/agent/providers/pi/ui-bridge/state.ts`'s `applyChannel`)
   * synthesizes ordinary `pi_ui_delta` upserts from it before the client
   * ever sees it, and `frames` below fixtures that already-synthesized
   * shape, not the extension-internal channel payload.
   */
  channel?: string;
  frames: FixtureFrame[];
}
