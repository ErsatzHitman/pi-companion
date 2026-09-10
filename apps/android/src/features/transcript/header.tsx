/**
 * plan.md §9.2 host/session header (T33A1) — the transcript screen's
 * `CompactSessionShell` `header` slot, redrawn as the redesign's S7 app
 * bar by T351.
 *
 * `header-model.ts` owns every string and tone decision (session title,
 * cwd subtitle, the pill's word and dot, the announced sentence); this
 * file is the native mapping of them onto `ScreenBar`
 * (`../../ui/recipes`, the bar all four redesigned screens share) and
 * `StatusPill` (`../../ui/primitives`, the artifact's 26dp `.pill`).
 *
 * **What replaced what.** The bar's two round marks are the new part:
 * `☰` opens this host's session list and `⧉` opens this session's Live
 * screen, so the two screens a user moves between mid-session are one
 * tap away instead of a back gesture and a row hunt. The title is the
 * session's, unchanged. The mono subtitle beside it is the session's
 * working directory basename, which the header never showed before. The
 * status readout keeps its `transcript-header-status-chip` testID on the
 * pill that replaced the `Chip`, so every flow and contract that finds
 * the status by that id still finds it — this redesign's
 * testID-continuity rule.
 *
 * **The marks are optional props, not this component's business.**
 * `onOpenSessions`/`onOpenLive` are supplied by the route, which is the
 * only place a router exists; with neither passed the bar simply draws
 * no marks, which is what any non-route mount (a lab, a test harness)
 * should get rather than a button that navigates nowhere.
 *
 * TalkBack: the outer wrapper is one `accessible` node carrying
 * `accessibilityLiveRegion="polite"` and the full announced sentence, so
 * a status change (e.g. connected → reconnecting) re-announces the whole
 * header without the reader needing to hunt for which piece changed —
 * colour is never the only signal (plan.md §10.5), the pill's visible
 * text always names the state too, and the sentence still carries the
 * host label the bar itself no longer draws. On-device announcement
 * timing is unverified here (no emulator in this workspace);
 * render/announcement proof belongs to the T37 Maestro flows.
 */
import { useMemo } from "react";
import { View } from "react-native";

import { StatusPill } from "../../ui/primitives";
import { ScreenBar, type ScreenBarAction } from "../../ui/recipes";
import { buildTranscriptHeaderViewModel, type TranscriptHeaderInput } from "./header-model";

export interface TranscriptHeaderProps extends TranscriptHeaderInput {
  /** Opens this host's session list (the artifact's `☰`). Omitted where no router exists. */
  onOpenSessions?: () => void;
  /** Opens this session's Live screen (the artifact's `⧉`). Omitted where no router exists. */
  onOpenLive?: () => void;
  testId?: string;
}

export function TranscriptHeader({
  hostLabel,
  sessionTitle,
  cwd,
  status,
  statusDetail,
  onOpenSessions,
  onOpenLive,
  testId = "transcript-header",
}: TranscriptHeaderProps) {
  const model = buildTranscriptHeaderViewModel({
    hostLabel,
    sessionTitle,
    cwd,
    status,
    statusDetail,
  });

  const leading: ScreenBarAction | undefined = useMemo(
    () =>
      onOpenSessions
        ? {
            mark: "☰",
            accessibleName: "Sessions",
            onPress: onOpenSessions,
            testId: `${testId}-sessions`,
          }
        : undefined,
    [onOpenSessions, testId],
  );
  const trailing: ScreenBarAction | undefined = useMemo(
    () =>
      onOpenLive
        ? { mark: "⧉", accessibleName: "Live", onPress: onOpenLive, testId: `${testId}-live` }
        : undefined,
    [onOpenLive, testId],
  );

  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={model.accessibilityLabel}
      testID={testId}
    >
      <ScreenBar
        title={model.title}
        subtitle={model.subtitle.length > 0 ? model.subtitle : undefined}
        leading={leading}
        trailing={trailing}
        status={
          <StatusPill
            label={model.chipLabel}
            tone={model.tone}
            showDot={model.showDot}
            testId={`${testId}-status-chip`}
          />
        }
        testId={`${testId}-bar`}
      />
    </View>
  );
}
