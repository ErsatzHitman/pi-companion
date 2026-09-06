/**
 * Derives the Expo config's `android.intentFilters` share-target block
 * from `share-intent-model.ts`'s allowlist (T36E, plan.md §9.3).
 *
 * **Why this exists as code, not a literal array typed twice**:
 * `classifyShareIntent` refuses anything outside `ACCEPTED_FILE_MIME_TYPES`
 * (plus `text/plain`). If `app.config.ts` declared a *different* MIME
 * list, the OS would offer this app as a share target for a type it then
 * silently refuses — a capability advertised to the whole system that the
 * app does not actually have (this task's brief). `app.config.ts` calls
 * `buildShareIntentFilters()` directly rather than duplicating the list,
 * so the two structurally cannot drift; `share-intent-config.test.ts`
 * still asserts the derived filters name exactly the allowlist, so a
 * change to `ACCEPTED_FILE_MIME_TYPES` that silently changed the
 * filters' shape would fail a test, not just "cannot happen by
 * construction".
 *
 * Deliberately excludes `SEND_MULTIPLE`: `classifyShareIntent` refuses
 * that action (`"unsupported-action"`, see its doc comment), so this
 * config never registers as a target for it either — the same
 * "don't advertise what you refuse" rule applied to the action, not
 * just the MIME type.
 */
import { ACCEPTED_FILE_MIME_TYPES } from "./share-intent-model.js";

/**
 * One `<data android:mimeType="…">` entry and one `<intent-filter>`, in
 * `@expo/config-types`' `AndroidIntentFiltersData`/`ExpoConfig
 * ["android"]["intentFilters"]` shape exactly (mutable arrays, not
 * `readonly`, so this assigns straight into `app.config.ts`'s
 * `android.intentFilters` with no cast).
 */
export interface ShareIntentFilterData {
  mimeType: string;
}

export interface ShareIntentFilter {
  action: "SEND";
  category: string[];
  data: ShareIntentFilterData[];
}

/**
 * The `text/plain` share-target filter. Kept separate from the file
 * filter below because Android intent resolution treats a bare
 * `text/plain` share (no `EXTRA_STREAM`) and a file share as distinct
 * `ACTION_SEND` deliveries, and `classifyShareIntent` branches on the
 * same distinction (`intent.file` present vs. `intent.mimeType`).
 */
const TEXT_MIME_TYPE = "text/plain";

/**
 * Builds the `android.intentFilters` array for `app.config.ts`: one
 * `SEND` filter for `text/plain`, one `SEND` filter whose `data` lists
 * every entry in `ACCEPTED_FILE_MIME_TYPES` — never more, never fewer.
 */
export function buildShareIntentFilters(): ShareIntentFilter[] {
  return [
    {
      action: "SEND",
      category: ["DEFAULT"],
      data: [{ mimeType: TEXT_MIME_TYPE }],
    },
    {
      action: "SEND",
      category: ["DEFAULT"],
      data: ACCEPTED_FILE_MIME_TYPES.map((mimeType) => ({ mimeType })),
    },
  ];
}
