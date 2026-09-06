import { z } from "zod";

/**
 * Shared Pi UI Bridge primitives (plan.md §11.3).
 *
 * These live in their own module so that both the element envelope
 * (`schema.ts`) and the typed per-kind payloads (`payload.ts`) can depend on
 * them without a circular import.
 */

export const PiUiPlacementSchema = z.enum(["status", "pinned", "inline", "sheet", "screen"]);

/** The frozen v1 vocabulary of ten element kinds (plan.md §11.3). */
export const PiUiKindSchema = z.enum([
  "status",
  "widget",
  "panel",
  "progress",
  "roster",
  "log",
  "markdown",
  "diff",
  "form",
  "composer",
]);

/**
 * Every kind except `panel`. A `panel` composes other kinds, so panel sections
 * are restricted to leaf kinds; this keeps the payload union finite and
 * avoids an unbounded recursive wire schema.
 */
export const PiUiLeafKindSchema = z.enum([
  "status",
  "widget",
  "progress",
  "roster",
  "log",
  "markdown",
  "diff",
  "form",
  "composer",
]);

export const PiUiToneSchema = z.enum(["default", "accent", "success", "warning", "error"]);

export const PiUiActionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  variant: z.enum(["primary", "secondary", "danger"]).optional(),
  confirm: z.string().optional(),
});

export type PiUiPlacement = z.infer<typeof PiUiPlacementSchema>;
export type PiUiKind = z.infer<typeof PiUiKindSchema>;
export type PiUiLeafKind = z.infer<typeof PiUiLeafKindSchema>;
export type PiUiTone = z.infer<typeof PiUiToneSchema>;
export type PiUiAction = z.infer<typeof PiUiActionSchema>;
