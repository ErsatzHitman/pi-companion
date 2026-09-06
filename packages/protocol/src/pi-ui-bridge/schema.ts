import { z } from "zod";
import { PiUiActionSchema, PiUiKindSchema, PiUiPlacementSchema } from "./primitives.js";
import { PiUiElementPayloadSchema } from "./payload.js";

export * from "./primitives.js";
export * from "./payload.js";

/**
 * Pi UI element envelope (plan.md §4.2, §11.3).
 *
 * Two rules keep this schema from losing helper data:
 *
 * 1. It is a **loose** object. Zod strips unlisted keys by default, which is
 *    exactly how `text`, `lines`, `rows`, `sections`, `value`, and `fields`
 *    used to disappear when the daemon parsed a `set` or `sync` op. Passthrough
 *    means no field is silently stripped, including extension-specific extras.
 * 2. The canonical `payload` is **optional** and there is no Zod transform
 *    here. Normalization of v1 top-level fields into `payload` belongs at the
 *    daemon boundary, not in the shared wire schema.
 */
export const PiUiElementSchema = z
  .object({
    id: z.string().min(1),
    ns: z.string().min(1),
    kind: PiUiKindSchema,
    placement: PiUiPlacementSchema,
    title: z.string().optional(),
    actions: z.array(PiUiActionSchema).optional(),
    ttl: z.number().int().nonnegative().optional(),
    durable: z.boolean().optional(),

    /**
     * Canonical typed payload. Optional on the wire: only daemons and clients
     * that negotiated `piUiPayloadV2` are guaranteed to populate or read it.
     */
    payload: PiUiElementPayloadSchema.optional(),

    // COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
    // Legacy v1 top-level projection, declared so it is typed rather than
    // merely tolerated by passthrough. Old helpers emit these; the daemon keeps
    // emitting them to clients without the piUiPayloadV2 capability.
    text: z.string().optional(),
    lines: z.array(z.string()).optional(),
    rows: z.array(z.unknown()).optional(),
    sections: z.array(z.unknown()).optional(),
    value: z.unknown().optional(),
    fields: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const PiUiStateSchema = z.object({
  agentId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  elements: z.array(PiUiElementSchema),
  updatedAt: z.string(),
});

export const PiUiDeltaSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert"),
    element: PiUiElementSchema,
  }),
  z.object({
    op: z.literal("remove"),
    id: z.string().min(1),
    ns: z.string().min(1).optional(),
  }),
  z.object({
    op: z.literal("reset"),
    elements: z.array(PiUiElementSchema),
    revision: z.number().int().nonnegative(),
  }),
]);

export const PiUiActionResultSchema = z.object({
  actionId: z.string().min(1),
  elementId: z.string().min(1),
  ok: z.boolean(),
  error: z.string().optional(),
});

export type PiUiElement = z.infer<typeof PiUiElementSchema>;
export type PiUiState = z.infer<typeof PiUiStateSchema>;
export type PiUiDelta = z.infer<typeof PiUiDeltaSchema>;
export type PiUiActionResult = z.infer<typeof PiUiActionResultSchema>;
