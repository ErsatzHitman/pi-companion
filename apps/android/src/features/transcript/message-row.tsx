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
 * **T308**: renders the message's own local wall-clock time from
 * `message-row-model.ts`'s `timestampLabelFor` — reasoning, tool-call,
 * todo, error, and compaction rows deliberately carry none, being
 * process detail rather than something either party said.
 *
 * **UI-P8 correction**: T308 drew that time as a visible caption under
 * every row. `docs/ui-reference/pi-companion-app.html` is not the
 * confirmed Android design: measured this session, it genuinely differs
 * (md5 `3ff70c21a0b512f169bad358608144f0`) from the confirmed
 * `android-spec.html` (md5 `498c3bd38ac8da0636e0bc05b705a7be`), so it
 * cannot be cited as this row's authority — unlike the web pair, which
 * really is byte-identical. The confirmed `android-spec.html` was
 * re-checked directly for this correction: its own `add('<div class="blk
 * usr">...` and `say(msg){}` calls building the `.md` prose block draw no
 * time at all under any turn either — not even the asymmetric `who`+time
 * line web's `TranscriptMeta` cites from the *other* mockup — so the
 * value below is unchanged, only the citation was wrong.
 * The visible `<Text>` below is now styled off-screen
 * (`styles.timestamp`, mirroring web's own `.pc-visually-hidden` recipe in
 * `ui/primitives/primitives.css` in RN terms) rather than deleted: the
 * full dated time stays this row's accessible name via
 * `accessibilityLabel` exactly as before, and every existing
 * testID/assertion on this element is unchanged.
 *
 * **T284**: forwards `resolveImageUri` unchanged to `MessageAttachments`
 * — see `message-row-model.ts`'s `TranscriptMessageRowProps.resolveImageUri`
 * doc comment for who supplies a real one and what renders without it.
 */
import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { timeline } from "@picompanion/frontend-core";

import { StreamingMessage } from "../../ui/recipes";
import { useTheme } from "../../ui/theme/theme-context";
import { MessageAttachments } from "./message-attachments";
import {
  areMessageRowPropsEqual,
  boundedText,
  isCoreMessageEntry,
  speakerFor,
  timestampLabelFor,
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
  // T308. Not memoized, for the same reason web's row is not: two
  // `Intl.DateTimeFormat` builds, reached only on a render
  // `areMessageRowPropsEqual` already let through.
  const stamp = timestampLabelFor(entry);

  // One `View` for every case now, where the no-attachments branch used to
  // return the bare `StreamingMessage`. The timestamp has to sit beneath the
  // message in both, and two branches each rendering it independently is how
  // the two drift apart.
  return (
    <View style={styles.row}>
      <StreamingMessage
        speaker={speakerFor(entry)}
        text={boundedText(entry.text)}
        streaming={streaming}
        testId={testId}
      />
      {images.length > 0 ? (
        <MessageAttachments
          images={images}
          entryId={entry.id}
          speaker={speakerFor(entry)}
          resolveImageUri={resolveImageUri}
          testId={testId ? `${testId}-attachments` : undefined}
        />
      ) : null}
      {stamp ? (
        <Text
          style={styles.timestamp}
          accessibilityLabel={stamp.title}
          testID={testId ? `${testId}-timestamp` : undefined}
        >
          {stamp.text}
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: { gap: theme.spacing[1] },
    /* Mirrors `thinking-row.tsx`'s `liveCaption` and web's
     * `.pc-transcript__timestamp`: the same `ink-3` de-emphasis and caption
     * size, so the numeric readouts in this transcript share one treatment
     * across both apps rather than three.
     *
     * UI-P8: also clipped to a single, overflow-hidden pixel and pulled
     * out of flex flow — the RN equivalent of web's own
     * `.pc-visually-hidden` (`ui/primitives/primitives.css`: `position:
     * absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden`)
     * — because the reference draws no visible time under any turn. The
     * colour/size above stay declared (an already-passing test pins them)
     * even though nothing sighted ever reads them now; the accessible
     * name is unaffected, since `accessibilityLabel` below is set
     * regardless of what is visually painted. */
    timestamp: {
      position: "absolute",
      width: 1,
      height: 1,
      margin: -1,
      padding: 0,
      overflow: "hidden",
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
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
