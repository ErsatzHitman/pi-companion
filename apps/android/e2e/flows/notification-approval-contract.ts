/**
 * T37E4 — single source of the testIds/copy `notification-approval.yaml`
 * asserts on for the in-app approval half of the flow (plan.md §14.4
 * "respond to an approval from a notification"). Onboarding + direct
 * pairing reuse `pairing-contract.ts`'s `PAIRING_FLOW` rather than a
 * second copy of the same strings — see this module's own file for why
 * that file is the single source for those.
 *
 * `notification-approval.contract.test.ts` is what actually proves
 * every value below still exists in the real feature source — this
 * file just gives the yaml's comments and that test one place to point
 * at instead of two copies of each string that could drift apart. Same
 * convention `pairing-contract.ts` documents.
 */
export const NOTIFICATION_APPROVAL_FLOW = {
  /**
   * `ApprovalsContainer.tsx` hardcodes `testId="approvals-dialog"` on
   * its `ApprovalsHost`; `ApprovalsHost.tsx` falls that straight
   * through to `Sheet`'s own `testId` (`sheetTestId = testId ??
   * "approvals-sheet"`), so this is the Sheet panel's real testID.
   */
  sheetTestId: "approvals-dialog",
  /** `Sheet`'s fixed title prop in `ApprovalsHost.tsx`. */
  sheetTitle: "Approval needed",
  /** `${sheetTestId}-form`, the `ApprovalForm` recipe's root testId for the `"binary"` panel case. */
  formTestId: "approvals-dialog-form",
  /** `${formTestId}-deny` / `${formTestId}-approve` — `ApprovalForm.tsx`'s two `Button`s. */
  denyButton: "approvals-dialog-form-deny",
  approveButton: "approvals-dialog-form-approve",
  /** `Button.tsx` sets `accessibilityLabel={label}` unconditionally, so these are also the two buttons' distinct accessible labels — see this file's own doc comment. */
  denyLabel: "Deny",
  approveLabel: "Approve",
  /** `ApprovalsHost.tsx`'s fixed `Banner` testId, shown when a send fails. */
  errorBannerTestId: "approvals-error-banner",
} as const;
