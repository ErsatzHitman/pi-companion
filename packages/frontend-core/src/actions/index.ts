/**
 * Actions domain — plan.md §6/§7, T47A1a.
 *
 * Owns single-answer arbitration for daemon-mediated approvals and dialogs
 * (`RequestArbitrator`, `arbitration.ts`): the state machine that makes an
 * approval or Pi UI dialog answerable exactly once across our two clients,
 * per plan.md §12.3. See `arbitration.ts`'s module doc for the full
 * rationale, the wire gap it works around, and the two kinds of local fact
 * a caller feeds it (`submitLocalAnswer`, `applyResolution`).
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 *
 * T103: `frontend-core`'s `package.json` `exports` map has a single "."
 * entry (no `./actions` subpath), so `src/index.ts`'s
 * `export * as actions from "./actions/index.js"` — not a subpath export —
 * is the only route a consuming workspace has to this domain. Before this
 * task, this file did not exist and `src/index.ts` named no `actions`
 * export at all, so `RequestArbitrator` was reachable from neither
 * `apps/web` nor `apps/android` (the exact bind T98 closed for the
 * extension fixtures, one directory over).
 */

export type {
  AnsweredBy,
  ArbitrationListener,
  ArbitrationOutcome,
  ArbitrationStatus,
  AuthoritativeResolution,
  RequestArbitratorOptions,
} from "./arbitration.js";
export { RequestArbitrator } from "./arbitration.js";
