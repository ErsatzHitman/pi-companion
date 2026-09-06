import { Banner, type BannerTone } from "../../ui/primitives";
import {
  describePermissionRecovery,
  type PermissionKind,
  type PermissionState,
} from "./permission-recovery";

export interface PermissionRecoveryNoticeProps {
  kind: PermissionKind;
  state: PermissionState;
  /** Called for `state`s whose recovery action is `"request"` (`"undetermined"`/`"denied"`). */
  onRequest?: () => void;
  /** Called for `"denied-permanently"` — the only state whose recovery action is `"open-settings"`. */
  onOpenSettings?: () => void;
  /** Called for `"granted"`/`"unavailable"` — states whose recovery action is `"dismiss"`. */
  onDismiss?: () => void;
  testId?: string;
}

/**
 * The reusable permission-recovery affordance (T33B7, plan.md §9.2).
 * Renders `permission-recovery.ts`'s `describePermissionRecovery` copy
 * through the shared `Banner` primitive — no raw hex colours, every
 * colour comes from `Banner`'s own theme tokens (plan.md's Android
 * invariant) — with the one action button that state's copy names.
 *
 * `Composer.tsx` mounts this for both the attachment (`kind="photos"`)
 * and microphone (`kind="microphone"`) permission gates; T36D reuses it
 * unchanged for the microphone permission it drives from its own voice
 * capture flow — passing `kind="microphone"` is the entire integration
 * point, per this task's brief ("via an affordance T36D can reuse for
 * the microphone").
 *
 * Renders nothing for `"granted"`: that state needs no persistent
 * recovery banner (a fleeting confirmation, if any, is the caller's
 * concern, not this affordance's).
 */
export function PermissionRecoveryNotice({
  kind,
  state,
  onRequest,
  onOpenSettings,
  onDismiss,
  testId,
}: PermissionRecoveryNoticeProps) {
  if (state === "granted") {
    return null;
  }

  const copy = describePermissionRecovery(kind, state);
  const tone: BannerTone =
    state === "denied-permanently" ? "danger" : state === "denied" ? "warning" : "info";
  const onAction =
    copy.action === "open-settings"
      ? onOpenSettings
      : copy.action === "request"
        ? onRequest
        : onDismiss;

  return (
    <Banner
      tone={tone}
      message={`${copy.title}. ${copy.message}`}
      actionLabel={copy.actionLabel}
      onAction={onAction}
      testId={testId}
    />
  );
}
