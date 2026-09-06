/**
 * plan.md §9.2 host/session header (T33A1) — the transcript screen's
 * `CompactSessionShell` `header` slot.
 *
 * `header-model.ts` owns every string and tone decision (session/host
 * text, status tone, the announced sentence); this file is the native
 * mapping onto `Section` (session title as the accessible heading) and
 * `Chip` (a short, tone-coloured status word next to the host label) —
 * both from `../../ui/primitives`, per this task's brief.
 *
 * TalkBack: the outer wrapper is one `accessible` node carrying
 * `accessibilityLiveRegion="polite"` and the full announced sentence, so
 * a status change (e.g. connected → reconnecting) re-announces the whole
 * header without the reader needing to hunt for which piece changed —
 * colour is never the only signal (plan.md §10.5), the chip's visible
 * text always names the state too. On-device announcement timing is
 * unverified here (no emulator in this workspace); render/announcement
 * proof belongs to the T37 Maestro flows, per this task's brief.
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Chip, Section } from "../../ui/primitives";
import { useTheme } from "../../ui/theme/theme-context";
import { buildTranscriptHeaderViewModel, type TranscriptHeaderInput } from "./header-model";

export interface TranscriptHeaderProps extends TranscriptHeaderInput {
  testId?: string;
}

export function TranscriptHeader({
  hostLabel,
  sessionTitle,
  status,
  statusDetail,
  testId = "transcript-header",
}: TranscriptHeaderProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = buildTranscriptHeaderViewModel({ hostLabel, sessionTitle, status, statusDetail });

  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={model.accessibilityLabel}
      testID={testId}
    >
      <Section title={model.title}>
        <View style={styles.row}>
          <Text style={styles.subtitle} numberOfLines={1}>
            {model.subtitle}
          </Text>
          <Chip label={model.chipLabel} tone={model.tone} testId={`${testId}-status-chip`} />
        </View>
      </Section>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[2],
    },
    subtitle: {
      flexShrink: 1,
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}
