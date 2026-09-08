/**
 * plan.md §9.3/§11.1 transcript message row (T33A2) — renders one
 * `user-message`/`assistant-message` `TranscriptEntry` in the compact
 * layout's `transcript` slot.
 *
 * A thin native view over `message-row-model.ts`, exactly mirroring
 * `apps/web/src/features/transcript/message-row.tsx`'s architecture: all
 * mapping/comparison logic lives in the RN-free model module (unit
 * tested there); this file only composes the `StreamingMessage` recipe
 * (`../../ui/recipes`, built in an earlier wave — read, not forked, per
 * this task's brief) and wraps the result in `memo` using the model's
 * comparator, so a live streaming update to the newest row does not
 * re-render every already-settled row already in the list.
 *
 * **T33A5**: also composes `./message-attachments.tsx`'s
 * `MessageAttachments` beneath the message text for `entry.images` — the
 * rendering `message-row-model.ts`'s prior doc comment named as a
 * deliberate gap for this task to close.
 *
 * **T284**: forwards `resolveImageUri` unchanged to `MessageAttachments`
 * — see `message-row-model.ts`'s `TranscriptMessageRowProps.resolveImageUri`
 * doc comment for who supplies a real one and what renders without it.
 */
import { memo, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import type { timeline } from "@picompanion/frontend-core";

import { StreamingMessage } from "../../ui/recipes";
import { useTheme } from "../../ui/theme/theme-context";
import { MessageAttachments } from "./message-attachments";
import {
  areMessageRowPropsEqual,
  boundedText,
  isCoreMessageEntry,
  speakerFor,
  type CoreMessageEntry,
  type TranscriptMessageRowProps,
} from "./message-row-model";

export type { CoreMessageEntry, TranscriptMessageRowProps } from "./message-row-model";
export { isCoreMessageEntry } from "./message-row-model";

function TranscriptMessageRowImpl({
  entry,
  streaming,
  resolveImageUri,
  testId,
}: TranscriptMessageRowProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const images = entry.images ?? [];

  if (images.length === 0) {
    return (
      <StreamingMessage
        speaker={speakerFor(entry)}
        text={boundedText(entry.text)}
        streaming={streaming}
        testId={testId}
      />
    );
  }

  return (
    <View style={styles.withAttachments}>
      <StreamingMessage
        speaker={speakerFor(entry)}
        text={boundedText(entry.text)}
        streaming={streaming}
        testId={testId}
      />
      <MessageAttachments
        images={images}
        entryId={entry.id}
        speaker={speakerFor(entry)}
        resolveImageUri={resolveImageUri}
        testId={testId ? `${testId}-attachments` : undefined}
      />
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    withAttachments: { gap: theme.spacing[2] },
  });
}

export const TranscriptMessageRow = memo(TranscriptMessageRowImpl, areMessageRowPropsEqual);

/** Re-exported so a caller can filter a mixed `TranscriptEntry[]` down to
 * the rows this component renders without importing the model module
 * directly. */
export function filterCoreMessageEntries(
  entries: readonly timeline.TranscriptEntry[],
): CoreMessageEntry[] {
  return entries.filter(isCoreMessageEntry);
}
