import { z } from "zod";
import {
  PiUiActionSchema,
  PiUiKindSchema,
  PiUiLeafKindSchema,
  PiUiToneSchema,
  type PiUiKind,
} from "./primitives.js";

/**
 * Typed Pi UI element payloads — step 1 of plan.md §4.2.
 *
 * Historically the element envelope validated only the common fields, so Zod's
 * default strip behaviour silently discarded `text`, `lines`, `rows`,
 * `sections`, `value`, and `fields` when the daemon parsed a `set` or `sync`
 * op. Every schema in this module is therefore:
 *
 * - **typed** for the fields the ten v1 kinds actually carry, and
 * - **loose** (`.passthrough()`), so extension-specific extras are carried
 *   through the wire instead of being dropped.
 *
 * The union discriminates on `kind`, which mirrors the owning element's
 * `kind`, so a payload is self-describing on the wire.
 */

/* -------------------------------------------------------------------------- */
/* status                                                                     */
/* -------------------------------------------------------------------------- */

/** Glanceable state. `text` falls back to the element title when absent. */
export const PiUiStatusPayloadSchema = z
  .object({
    kind: z.literal("status"),
    text: z.string().optional(),
    detail: z.string().optional(),
    tone: PiUiToneSchema.optional(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/* widget                                                                     */
/* -------------------------------------------------------------------------- */

export const PiUiWidgetRowSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().optional(),
    text: z.string().optional(),
    value: z.string().optional(),
    detail: z.string().optional(),
    tone: PiUiToneSchema.optional(),
  })
  .passthrough();

/** Persistent summary: free text, pre-split lines, or labelled rows. */
export const PiUiWidgetPayloadSchema = z
  .object({
    kind: z.literal("widget"),
    text: z.string().optional(),
    lines: z.array(z.string()).optional(),
    rows: z.array(PiUiWidgetRowSchema).optional(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/* progress                                                                   */
/* -------------------------------------------------------------------------- */

/** Determinate (`value`/`max`) or indeterminate work indicator. */
export const PiUiProgressPayloadSchema = z
  .object({
    kind: z.literal("progress"),
    label: z.string().optional(),
    detail: z.string().optional(),
    value: z.number().optional(),
    max: z.number().optional(),
    indeterminate: z.boolean().optional(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/* roster                                                                     */
/* -------------------------------------------------------------------------- */

export const PiUiRosterRowStateSchema = z.enum(["idle", "running", "blocked", "done", "error"]);

export const PiUiRosterRowProgressSchema = z
  .object({
    value: z.number().optional(),
    max: z.number().optional(),
    indeterminate: z.boolean().optional(),
  })
  .passthrough();

export const PiUiRosterRowSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    state: PiUiRosterRowStateSchema.optional(),
    detail: z.string().optional(),
    progress: PiUiRosterRowProgressSchema.optional(),
    /** Per-row actions. Routing uses composite `ns:id:rowId:actionId` identity. */
    actions: z.array(PiUiActionSchema).optional(),
  })
  .passthrough();

/** Agents, roles, keys, or tasks with per-row actions. */
export const PiUiRosterPayloadSchema = z
  .object({
    kind: z.literal("roster"),
    rows: z.array(PiUiRosterRowSchema),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/* log                                                                        */
/* -------------------------------------------------------------------------- */

/** Streaming lines. This is the only payload that supports `append`. */
export const PiUiLogPayloadSchema = z
  .object({
    kind: z.literal("log"),
    lines: z.array(z.string()),
    /** Renderer hint: keep only the last N lines. */
    tail: z.number().int().positive().optional(),
    mono: z.boolean().optional(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/* markdown                                                                   */
/* -------------------------------------------------------------------------- */

/** Rich textual content rendered by the platform markdown renderer. */
export const PiUiMarkdownPayloadSchema = z
  .object({
    kind: z.literal("markdown"),
    text: z.string(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/* diff                                                                       */
/* -------------------------------------------------------------------------- */

/** Unified changes. `unifiedDiff` is the canonical name; v1 also used `diff`. */
export const PiUiDiffPayloadSchema = z
  .object({
    kind: z.literal("diff"),
    unifiedDiff: z.string(),
    filePath: z.string().optional(),
    language: z.string().optional(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/* form                                                                       */
/* -------------------------------------------------------------------------- */

export const PiUiFormOptionSchema = z
  .object({
    value: z.string(),
    label: z.string(),
    description: z.string().optional(),
  })
  .passthrough();

export const PiUiFormFieldSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      id: z.string().min(1),
      label: z.string(),
      placeholder: z.string().optional(),
      multiline: z.boolean().optional(),
      required: z.boolean().optional(),
      value: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("select"),
      id: z.string().min(1),
      label: z.string(),
      options: z.array(PiUiFormOptionSchema),
      multiple: z.boolean().optional(),
      searchable: z.boolean().optional(),
      required: z.boolean().optional(),
      value: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("toggle"),
      id: z.string().min(1),
      label: z.string(),
      description: z.string().optional(),
      value: z.boolean().optional(),
    })
    .passthrough(),
]);

/** Structured questions, submitted through a normal element action. */
export const PiUiFormPayloadSchema = z
  .object({
    kind: z.literal("form"),
    fields: z.array(PiUiFormFieldSchema),
    description: z.string().optional(),
    submitLabel: z.string().optional(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/* composer                                                                   */
/* -------------------------------------------------------------------------- */

/** Replace or prefill the draft. `previousText` powers the undo path. */
export const PiUiComposerPayloadSchema = z
  .object({
    kind: z.literal("composer"),
    text: z.string(),
    mode: z.enum(["replace", "prefill", "append"]).optional(),
    previousText: z.string().optional(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/* panel                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every payload except `panel`. A panel composes other kinds (plan.md §11.3),
 * so panels do not nest and the wire schema stays non-recursive.
 */
export const PiUiLeafPayloadSchema = z.discriminatedUnion("kind", [
  PiUiStatusPayloadSchema,
  PiUiWidgetPayloadSchema,
  PiUiProgressPayloadSchema,
  PiUiRosterPayloadSchema,
  PiUiLogPayloadSchema,
  PiUiMarkdownPayloadSchema,
  PiUiDiffPayloadSchema,
  PiUiFormPayloadSchema,
  PiUiComposerPayloadSchema,
]);

/** One composed child of a `panel`. Carries its own leaf payload. */
export const PiUiPanelSectionSchema = z
  .object({
    id: z.string().min(1),
    ns: z.string().min(1).optional(),
    kind: PiUiLeafKindSchema,
    title: z.string().optional(),
    actions: z.array(PiUiActionSchema).optional(),
    payload: PiUiLeafPayloadSchema.optional(),
  })
  .passthrough();

/** Composed focused view. */
export const PiUiPanelPayloadSchema = z
  .object({
    kind: z.literal("panel"),
    sections: z.array(PiUiPanelSectionSchema),
    text: z.string().optional(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/* union + lookup                                                             */
/* -------------------------------------------------------------------------- */

/** Canonical typed payload for any of the ten v1 kinds. */
export const PiUiElementPayloadSchema = z.discriminatedUnion("kind", [
  PiUiStatusPayloadSchema,
  PiUiWidgetPayloadSchema,
  PiUiPanelPayloadSchema,
  PiUiProgressPayloadSchema,
  PiUiRosterPayloadSchema,
  PiUiLogPayloadSchema,
  PiUiMarkdownPayloadSchema,
  PiUiDiffPayloadSchema,
  PiUiFormPayloadSchema,
  PiUiComposerPayloadSchema,
]);

/**
 * Per-kind schema lookup. The `satisfies` clause is the compile-time guarantee
 * that all ten kinds from `PiUiKindSchema` have a typed payload schema.
 */
export const PI_UI_PAYLOAD_SCHEMAS = {
  status: PiUiStatusPayloadSchema,
  widget: PiUiWidgetPayloadSchema,
  panel: PiUiPanelPayloadSchema,
  progress: PiUiProgressPayloadSchema,
  roster: PiUiRosterPayloadSchema,
  log: PiUiLogPayloadSchema,
  markdown: PiUiMarkdownPayloadSchema,
  diff: PiUiDiffPayloadSchema,
  form: PiUiFormPayloadSchema,
  composer: PiUiComposerPayloadSchema,
} satisfies Record<PiUiKind, z.ZodTypeAny>;

/** Every kind that has a typed payload schema, in `PiUiKindSchema` order. */
export const PI_UI_PAYLOAD_KINDS: readonly PiUiKind[] = PiUiKindSchema.options;

/** Returns the typed payload schema for one element kind. */
export function piUiPayloadSchemaForKind<K extends PiUiKind>(
  kind: K,
): (typeof PI_UI_PAYLOAD_SCHEMAS)[K] {
  return PI_UI_PAYLOAD_SCHEMAS[kind];
}

/**
 * True when a payload's discriminator agrees with its element's `kind`.
 *
 * This check lives here rather than as a refinement on the shared wire schema:
 * plan.md §4.2 requires the wire schema to stay a plain, transform-free,
 * permissive envelope, so mismatches are reconciled at the daemon boundary.
 */
export function piUiPayloadMatchesKind(kind: string, payload: unknown): boolean {
  if (payload === undefined || payload === null) return true;
  if (typeof payload !== "object") return false;
  return (payload as { kind?: unknown }).kind === kind;
}

/** Only `log` payloads support the v1 `append` op (plan.md §4.2). */
export function piUiKindSupportsAppend(kind: string): boolean {
  return kind === "log";
}

export type PiUiStatusPayload = z.infer<typeof PiUiStatusPayloadSchema>;
export type PiUiWidgetRow = z.infer<typeof PiUiWidgetRowSchema>;
export type PiUiWidgetPayload = z.infer<typeof PiUiWidgetPayloadSchema>;
export type PiUiProgressPayload = z.infer<typeof PiUiProgressPayloadSchema>;
export type PiUiRosterRowState = z.infer<typeof PiUiRosterRowStateSchema>;
export type PiUiRosterRow = z.infer<typeof PiUiRosterRowSchema>;
export type PiUiRosterPayload = z.infer<typeof PiUiRosterPayloadSchema>;
export type PiUiLogPayload = z.infer<typeof PiUiLogPayloadSchema>;
export type PiUiMarkdownPayload = z.infer<typeof PiUiMarkdownPayloadSchema>;
export type PiUiDiffPayload = z.infer<typeof PiUiDiffPayloadSchema>;
export type PiUiFormOption = z.infer<typeof PiUiFormOptionSchema>;
export type PiUiFormField = z.infer<typeof PiUiFormFieldSchema>;
export type PiUiFormPayload = z.infer<typeof PiUiFormPayloadSchema>;
export type PiUiComposerPayload = z.infer<typeof PiUiComposerPayloadSchema>;
export type PiUiPanelSection = z.infer<typeof PiUiPanelSectionSchema>;
export type PiUiPanelPayload = z.infer<typeof PiUiPanelPayloadSchema>;
export type PiUiLeafPayload = z.infer<typeof PiUiLeafPayloadSchema>;
export type PiUiElementPayload = z.infer<typeof PiUiElementPayloadSchema>;
