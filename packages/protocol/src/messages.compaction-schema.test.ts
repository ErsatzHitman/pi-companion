/**
 * T143: `AgentTimelineItemPayloadSchema`'s `"compaction"` branch previously
 * validated only `status`/`trigger`/`preTokens`, so Pi's structured
 * compaction result (`summary`, `estimatedTokensAfter`, `filesRead`,
 * `filesModified` — carried onto `CompactionTimelineItem` by the daemon,
 * see `packages/server/src/server/agent/providers/pi/rpc-types.ts`'s
 * `PiCompactionResult`) would have been silently stripped by `z.object`'s
 * default "drop unknown keys" behavior on its way through
 * `@picompanion/client`'s wire validation
 * (`validateWSOutboundMessage` in `./validation/ws-outbound.ts`) — a real
 * daemon field lost at a schema boundary, not a code path, so this proves
 * it with the schema directly rather than a network round trip.
 */
import { describe, expect, it } from "vitest";

import { AgentTimelineItemPayloadSchema } from "./messages.js";

describe("AgentTimelineItemPayloadSchema: compaction (T143)", () => {
  it("parses a completed compaction item carrying Pi's full result and keeps every field", () => {
    const parsed = AgentTimelineItemPayloadSchema.parse({
      type: "compaction",
      status: "completed",
      trigger: "auto",
      preTokens: 128_000,
      summary: "Discussed the auth refactor and merged two branches.",
      estimatedTokensAfter: 4_000,
      filesRead: ["a.ts", "b.ts"],
      filesModified: ["c.ts"],
    });

    expect(parsed).toEqual({
      type: "compaction",
      status: "completed",
      trigger: "auto",
      preTokens: 128_000,
      summary: "Discussed the auth refactor and merged two branches.",
      estimatedTokensAfter: 4_000,
      filesRead: ["a.ts", "b.ts"],
      filesModified: ["c.ts"],
    });
  });

  it("still parses a minimal loading compaction item with none of the new fields", () => {
    const parsed = AgentTimelineItemPayloadSchema.parse({
      type: "compaction",
      status: "loading",
    });

    expect(parsed).toEqual({ type: "compaction", status: "loading" });
    expect(parsed).not.toHaveProperty("summary");
    expect(parsed).not.toHaveProperty("filesRead");
  });

  it("rejects a non-array filesRead instead of coercing it", () => {
    const result = AgentTimelineItemPayloadSchema.safeParse({
      type: "compaction",
      status: "completed",
      filesRead: "a.ts",
    });

    expect(result.success).toBe(false);
  });
});
