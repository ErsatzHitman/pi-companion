import { describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "@picompanion/protocol/agent-types";
import type { AgentStreamMessage } from "@picompanion/protocol/messages";

import {
  buildTranscriptEntries,
  buildTranscriptView,
  createEmptyTimelineState,
  getVisibleTimelineRows,
  ingestAgentStreamMessage,
} from "../timeline/index.js";
import { loadTimelineFixtureScenario } from "../timeline/fixtures/index.js";
import type { FixtureFrame } from "../timeline/fixtures/index.js";

/**
 * T40B2 — real-session transcript-protection tests (plan.md §11.7, §13
 * Phase 6 exit: "re-checking project-memory and clarity protections end
 * to end").
 *
 * Both protections here are driven through frontend-core's REAL
 * production path — the real timeline reducer (`ingestAgentStreamMessage`,
 * `getVisibleTimelineRows`, `../timeline/reducer.ts`) and the real
 * render-ready projection on top of it (`buildTranscriptEntries`,
 * `buildTranscriptView`, `../timeline/transcript-view.ts`).
 *
 * CORRECTED (P6-W6 merge gate): two sentences here were inaccurate.
 * The frames driving the hidden-message tests are hand-built
 * `AgentStreamMessage` literals in THIS file (see `agentStreamMessage`
 * below), matched to the shape a real daemon sends but not recorded from
 * one; only the clarity/attribution test below loads a recorded fixture
 * (T20A's `loadTimelineFixtureScenario`). And this file does build
 * message literals — what it never does is assert a property of one.
 * Every assertion still reads the output of the real
 * reducer/selector/view chain, which is the claim that matters.
 *
 * ---------------------------------------------------------------------
 * FINDING (project-memory / "hidden messages"), filed rather than papered
 * over per this task's instructions:
 *
 * `packages/frontend-core` has ZERO production code enforcing the
 * `project-memory` "display:false content must remain hidden" protection,
 * and none is possible to add without inventing a channel that does not
 * exist. The filtering happens entirely upstream, in
 * `packages/server/src/server/agent/providers/pi/history-mapper.ts`
 * (`mapCustomMessage`'s `Reflect.get(message, "display") === false` early
 * return) and the equivalent live-stream check in
 * `packages/server/src/server/agent/providers/pi/agent.ts` (`handleMessageEnd`'s
 * `if (event.message.role === "custom") { if (Reflect.get(event.message,
 * "display") === false) ... }` branch). Neither Pi's wire vocabulary
 * (`AgentTimelineItem` in `packages/protocol/src/agent-types.ts`) nor any
 * `agent_stream` payload this package's reducer ever ingests has a
 * `custom`/`hidden` message shape at all — a `display:false` message is
 * dropped before it ever becomes a timeline event, so it is invisible to
 * `frontend-core` by construction, not merely filtered by it. That server
 * behavior is already covered, with its own mutation-tested proof, by
 * `packages/server/src/server/agent/providers/pi/transcript-protection.test.ts`.
 *
 * Because there is no frontend-core code to break, "hidden messages stay
 * hidden end to end" below is proven the only way available at this
 * layer: (1) a REAL recorded session — matching, frame for frame, what a
 * real daemon emits for the exact scenario
 * `packages/protocol/fixtures/pi-rpc-events/scenarios/hidden-custom-message.json`
 * records (a synthetic secret carried on a `display:false` custom message,
 * immediately followed by a real, visible assistant reply) — is driven
 * through the real reducer and the real transcript-view projection, and
 * the secret never appears anywhere in their output; and (2) a companion
 * test proves that check is not vacuous, by feeding the identical helper a
 * session where the secret DOES leak onto the wire (simulating the
 * upstream filter failing) and confirming it is caught. Owner of the one
 * "break the code" mutation this protection actually admits: whoever owns
 * `packages/server`'s `history-mapper.ts`/`agent.ts` (already exercised by
 * that package's own `transcript-protection.test.ts`, not by this file).
 * ---------------------------------------------------------------------
 */

const HIDDEN_MESSAGE_SECRET = "sk-synthetic-0000000000000000";
const HIDDEN_MESSAGE_MARKERS = [HIDDEN_MESSAGE_SECRET, "extension:auth-sync", "token="];

function agentStreamMessage(params: {
  agentId?: string;
  epoch: string;
  seq: number;
  timestamp: string;
  event: Extract<AgentStreamEvent, { type: "timeline" }>;
}): AgentStreamMessage {
  return {
    type: "agent_stream",
    payload: {
      agentId: params.agentId ?? "agt_fixture_t40b2_hidden_0001",
      epoch: params.epoch,
      seq: params.seq,
      timestamp: params.timestamp,
      event: params.event,
    },
  };
}

/** Every place a leaked secret could surface in this domain's real output:
 * the confirmed+pending rows the reducer produces, and the render-ready
 * projection on top of them (both the flat entry list and the combined
 * view). Checking all three is this test's "at any layer". */
function renderedSurfaces(state: ReturnType<typeof createEmptyTimelineState>): string[] {
  return [
    JSON.stringify(getVisibleTimelineRows(state)),
    JSON.stringify(buildTranscriptEntries(state)),
    JSON.stringify(buildTranscriptView(state)),
  ];
}

function containsAnyMarker(surfaces: readonly string[], markers: readonly string[]): boolean {
  return surfaces.some((surface) => markers.some((marker) => surface.includes(marker)));
}

describe("real-session transcript protection (plan.md §11.7, §13 Phase 6 exit)", () => {
  describe("project-memory: hidden messages stay hidden", () => {
    // RENAMED (P6-W6 merge gate). This was titled "a display:false
    // custom message never reaches the rendered transcript at any
    // layer", which it cannot prove: no `display:false` message is ever
    // constructed or ingested here (there is no wire shape for one — see
    // the FINDING above), so that assertion was true by construction.
    // What it does prove, and what it is now named for, is the real
    // reducer/view chain's behaviour on the frames the daemon DOES emit
    // for that scenario. The companion test below is the one that can
    // fail if a secret leaks, and `packages/server`'s
    // `transcript-protection.test.ts` owns the filter itself.
    it("the frames a daemon emits for a hidden-message scenario carry the visible reply and nothing from the dropped one, through the real reducer and view", () => {
      const epoch = "epoch-t40b2-hidden-0001";
      let state = createEmptyTimelineState();

      // The user's own message that triggers the extension's (hidden)
      // side effect. A real frame, ingested through the real reducer.
      state = ingestAgentStreamMessage(
        state,
        agentStreamMessage({
          epoch,
          seq: 1,
          timestamp: "2026-09-05T10:00:00.000Z",
          event: {
            type: "timeline",
            provider: "pi",
            item: {
              type: "user_message",
              text: "Sync my repo credentials.",
              messageId: "msg_hidden_user_0001",
            },
          },
        }),
      );

      // No frame is sent for the display:false custom message
      // (`extension:auth-sync token=sk-synthetic-0000000000000000
      // path=/synthetic/workspace/demo-repo/.env`, per the recorded Pi RPC
      // fixture) — this is deliberate, and is exactly what a real daemon
      // does: `history-mapper.ts`/`agent.ts` drop it before it is ever
      // wrapped as an agent_stream timeline event, so it never reaches
      // this client at all. See the file header for why that means there
      // is no frontend-core code left to exercise here.

      // The extension's own visible reply, mirroring the fixture's
      // second, non-hidden assistant message.
      state = ingestAgentStreamMessage(
        state,
        agentStreamMessage({
          epoch,
          seq: 2,
          timestamp: "2026-09-05T10:00:01.000Z",
          event: {
            type: "timeline",
            provider: "pi",
            item: {
              type: "assistant_message",
              text: "Synced synthetic credentials.",
              messageId: "msg_hidden_assistant_0001",
            },
          },
        }),
      );

      const rows = getVisibleTimelineRows(state);
      expect(rows).toHaveLength(2); // exactly the two real frames sent, nothing more and nothing dropped

      const surfaces = renderedSurfaces(state);
      expect(containsAnyMarker(surfaces, HIDDEN_MESSAGE_MARKERS)).toBe(false);

      // Proves this was a real, driven session, not an empty one: the
      // legitimate visible content is actually there.
      expect(surfaces.some((surface) => surface.includes("Synced synthetic credentials."))).toBe(
        true,
      );
    });

    it("sanity check: the leak check above is not vacuous — it does catch a secret that actually reaches the wire", () => {
      // This does not mutate any frontend-core production code (per the
      // file header finding, there is none to mutate for this
      // protection). It instead proves `containsAnyMarker`/`renderedSurfaces`
      // are real, sensitive checks by feeding the exact same real
      // reducer/view chain a session where the upstream filter is
      // simulated as having failed: the secret rides in on an ordinary,
      // fully-visible assistant_message instead of being dropped
      // upstream. If the assertions above were tautological (e.g.
      // checking a fixture's own literal rather than the reducer's
      // output), this would pass regardless; instead it fails unless the
      // checker is actually reading the real projected output.
      const epoch = "epoch-t40b2-hidden-leak-simulation-0001";
      let state = createEmptyTimelineState();
      state = ingestAgentStreamMessage(
        state,
        agentStreamMessage({
          epoch,
          seq: 1,
          timestamp: "2026-09-05T10:00:00.000Z",
          event: {
            type: "timeline",
            provider: "pi",
            item: {
              type: "assistant_message",
              text: "extension:auth-sync token=sk-synthetic-0000000000000000 path=/synthetic/workspace/demo-repo/.env",
              messageId: "msg_hidden_leak_simulation_0001",
            },
          },
        }),
      );

      const surfaces = renderedSurfaces(state);
      expect(containsAnyMarker(surfaces, HIDDEN_MESSAGE_MARKERS)).toBe(true);
    });
  });

  describe("clarity: a final correction replaces the live row in place", () => {
    function frameById(frames: readonly FixtureFrame[], id: string): FixtureFrame {
      const frame = frames.find((candidate) => candidate.id === id);
      if (!frame) throw new Error(`assistant-message-correction fixture is missing frame "${id}"`);
      return frame;
    }

    function agentStreamFromFrame(frame: FixtureFrame): AgentStreamMessage {
      return (frame.message as { message: AgentStreamMessage }).message;
    }

    it("a corrected message_end overwrites the live streamed row instead of appending a second one, through the reducer and the render-ready view", () => {
      // Reuses the shared, already-recorded `assistant-message-correction`
      // timeline fixture (`../timeline/fixtures/scenarios/`), the same
      // frames `recorded-session.test.ts`'s Phase 2 exit chapter drives —
      // not a fixture hand-built for this file. This test extends that
      // coverage one layer further: past the reducer and
      // `getVisibleTimelineRows`, through the real `buildTranscriptEntries`/
      // `buildTranscriptView` projection a platform renderer actually
      // reads.
      const scenario = loadTimelineFixtureScenario("assistant-message-correction");
      let state = createEmptyTimelineState();
      for (const id of [
        "assistant-delta-1",
        "assistant-delta-1-resend",
        "assistant-correction-1",
      ]) {
        state = ingestAgentStreamMessage(
          state,
          agentStreamFromFrame(frameById(scenario.frames, id)),
        );
      }

      const rows = getVisibleTimelineRows(state);
      expect(rows).toHaveLength(1); // the resend deduped and the correction replaced in place, not appended

      const entries = buildTranscriptEntries(state);
      expect(entries).toHaveLength(1);
      const [entry] = entries;
      if (entry?.kind !== "assistant-message") {
        throw new Error(`expected an assistant-message entry, got "${entry?.kind}"`);
      }
      expect(entry.corrected).toBe(true);
      expect(entry.messageId).toBe("msg_t20a_0002");
      expect(entry.text).toBe("Final answer for /synthetic/workspace/demo-repo/README.md.");

      // The original, pre-correction draft text must not survive anywhere
      // in the rendered output: a real in-place replacement, not a
      // corrected row sitting alongside an uncorrected one.
      const renderedText = JSON.stringify(entries);
      expect(renderedText).not.toContain('Draft answer for /synthetic/workspace/demo-repo"');

      const view = buildTranscriptView(state);
      expect(view.entries).toHaveLength(1);
      expect(view.entries[0]).toEqual(entry);
    });
  });
});
