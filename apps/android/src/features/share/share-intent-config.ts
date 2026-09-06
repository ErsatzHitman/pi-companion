/**
 * Reference derivation of the Expo config's `android.intentFilters`
 * share-target block from `share-intent-model.ts`'s allowlist (T36E,
 * plan.md §9.3).
 *
 * **CORRECTED (T201): `app.config.ts` no longer calls `buildShareIntentFilters`
 * below.** T36E's original comment here said it did; that stopped being
 * true because `expo prebuild`/`expo config` failed on every run —
 * `@expo/config` transpiles only `app.config.ts` itself to CommonJS and
 * evaluates it with `require-from-string`; `@expo/require-utils`'s
 * loader registers no `.ts` handler for a nested `require`, so a
 * relative import of `share-intent-config.ts` (which itself imports
 * `share-intent-model.ts` — two hops of TypeScript deep) became a plain
 * Node `require` against the real filesystem, where only the `.ts`
 * source exists: "Cannot find module
 * './src/features/share/share-intent-config.js'". Dropping the
 * extension fails the same way; the loader has no `.ts` handler at all
 * for a nested require.
 *
 * `app.config.ts` now `import`s `accepted-file-mime-types.json` directly
 * — Node's CJS loader handles `.json` natively, so a JSON file needs no
 * transform and is the one relative module `app.config.ts` CAN reach —
 * and builds its two `SEND` filters inline from that same JSON.
 * `ACCEPTED_FILE_MIME_TYPES` above and `app.config.ts`'s filters both
 * derive from that one JSON file, so the MIME *list* structurally cannot
 * drift between them.
 *
 * `buildShareIntentFilters` below is no longer `app.config.ts`'s
 * derivation; it stays as this feature's independently-tested pure
 * reference implementation of the filter *shape* (also part of this
 * feature's package barrel — `index.ts`, outside this task's grant).
 * Because `app.config.ts` must reconstruct that two-filter shape inline
 * rather than calling this function, the shape itself is the one thing
 * that could still drift — so `share-intent-config.test.ts` asserts
 * `app.config.ts`'s actual, real `android.intentFilters` output against
 * both `ACCEPTED_FILE_MIME_TYPES` directly and against this function's
 * output, so either kind of drift fails a test rather than merely
 * "cannot happen by construction".
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
 * Reference derivation of an `android.intentFilters` array: one `SEND`
 * filter for `text/plain`, one `SEND` filter whose `data` lists every
 * entry in `ACCEPTED_FILE_MIME_TYPES` — never more, never fewer. See
 * this module's doc comment for why `app.config.ts` builds the same
 * shape inline instead of calling this function, and how
 * `share-intent-config.test.ts` keeps the two from drifting apart.
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
