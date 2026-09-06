/**
 * T37E5 — single source of the testIds and literal copy
 * `../../maestro/extension-sheets.yaml` restates inline (plan.md §14.4
 * "roster, form, and panel sheets"). RN-free by construction (a plain
 * object of strings/functions), matching `pairing-contract.ts`'s
 * precedent exactly: Maestro's `.yaml` has no module system, so the flow
 * cannot literally `import` this file — `extension-sheets.contract.test.ts`
 * is what actually keeps every restatement honest against real source,
 * not this file by itself.
 *
 * Every id-building helper below mirrors the exact template literal the
 * named renderer builds it with — see that test file's `readCode()`
 * assertions for the proof each one is still correct.
 */

/** `roster.tsx`'s `RosterRenderer`/`RosterRow` (T34B1). */
export const ROSTER_FLOW = {
  /** `pi-roster-${element.ns}-${element.id}` — the `Card`'s own testID. */
  cardTestId: (ns: string, id: string): string => `pi-roster-${ns}-${id}`,
  /** `pi-roster-row-${row.key}` — one row's outer `accessible` `View`. */
  rowTestId: (rowKey: string): string => `pi-roster-row-${rowKey}`,
  /** `pi-roster-row-${row.key}-action-${action.id}` — one row action `Button`. */
  rowActionTestId: (rowKey: string, actionId: string): string =>
    `pi-roster-row-${rowKey}-action-${actionId}`,
  /** `buildRosterRenderModel`'s `emptyText` when `payload.rows.length === 0`. */
  emptyText: "No rows to show.",
} as const;

/** `form.tsx`'s `FormRenderer` (T34B2) — always a `Sheet`, regardless of `element.placement`. */
export const FORM_FLOW = {
  /** `pi-form-${element.ns}-${element.id}` — the `Sheet`'s own `testId`. */
  sheetTestId: (ns: string, id: string): string => `pi-form-${ns}-${id}`,
  /** `${testId}-field-${field.id}` — one field's input primitive. */
  fieldTestId: (sheetTestId: string, fieldId: string): string => `${sheetTestId}-field-${fieldId}`,
  /** `${testId}-action-${action.id}` — one submit/cancel `Button`. */
  actionTestId: (sheetTestId: string, actionId: string): string =>
    `${sheetTestId}-action-${actionId}`,
  /** `Sheet`'s `description` prop fallback when `payload.description` is unset. */
  defaultDescription: "Fill in the form below.",
  /** `buildFormRenderModel`'s `emptyText` when `payload.fields.length === 0`. */
  emptyText: "No fields to show.",
  /** `resolveFormSubmitGate`'s single-field summary line. */
  oneFieldErrorSummary: "Fix 1 field before submitting.",
} as const;

/**
 * `panel.tsx`'s `PanelRenderer` (T34B4). Only the `element.placement ===
 * "pinned"` (inline-card) path is reachable through today's live wiring
 * — see this task's report for exactly why `element.placement === "sheet"`
 * can never be reached from `PinnedLiveExtensionArea`, the app's one live
 * mount point (`selectPinnedElements` in `pinned-model.ts` admits only
 * `placement: "pinned"` elements, and a single element can't carry two
 * placement values at once).
 */
export const PANEL_FLOW = {
  /** `pi-panel-${element.ns}-${element.id}` — the outer `Card`/`View`'s testID either way. */
  cardTestId: (ns: string, id: string): string => `pi-panel-${ns}-${id}`,
  /** `${testId}-sections` — the `ScrollView` wrapping every resolved section. */
  sectionsTestId: (cardTestId: string): string => `${cardTestId}-sections`,
  /** `${testId}-section-${section.id}` — one section's own wrapping `View`. */
  sectionTestId: (cardTestId: string, sectionId: string): string =>
    `${cardTestId}-section-${sectionId}`,
  /** `element.title ?? "Panel"`. */
  defaultTitle: "Panel",
  /** `buildPanelRenderModel`'s `emptyText` when `payload.sections.length === 0`. */
  emptyText: "No sections to show.",
} as const;
