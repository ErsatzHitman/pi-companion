/**
 * plan.md §9.3/§11.1/§11.6 message image/attachment view (T33A5) — the
 * native view over `message-attachments-model.ts` (see that module's doc
 * comment for the full rationale, including why every image renders as
 * an accessible reference card rather than a live preview this wave).
 *
 * Composes only already-built primitives (`../../ui/primitives`, read but
 * never forked or edited per this task's brief), exactly as
 * `message-row.tsx` and `tool-call-row.tsx` do over their own model
 * modules.
 */
import { useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";

import { Card } from "../../ui/primitives";
import { useTheme } from "../../ui/theme/theme-context";
import {
  MAX_IMAGES_PER_ENTRY,
  boundImages,
  imageAttachmentViewModel,
  imageGroupAccessibilityLabel,
  type AttachmentImageContext,
} from "./message-attachments-model";

export {
  MAX_IMAGES_PER_ENTRY,
  MAX_INLINE_IMAGE_BYTES,
  type AttachmentImageContext,
  type ImageAttachmentViewModel,
} from "./message-attachments-model";

/**
 * Resolves an image reference to a browser/native-fetchable URI — the
 * same optional seam web's `ResolveImageSrc` establishes. `undefined`
 * (the default: no resolver supplied, or the resolver itself returns
 * `undefined` for this image) always falls back to the accessible
 * reference card; a future daemon RPC can be wired in here with no
 * change to this file's shape. Never called for an oversized image (see
 * `imageAttachmentViewModel`'s `oversized` flag) — an oversized image
 * always shows its reference card, regardless of whether a resolver
 * exists.
 */
export type ResolveImageUri = (
  image: AgentTimelineImageRef,
  context: AttachmentImageContext,
) => string | undefined;

export interface MessageAttachmentsProps {
  readonly images: ReadonlyArray<AgentTimelineImageRef>;
  readonly entryId: string;
  readonly speaker: "assistant" | "user";
  readonly resolveImageUri?: ResolveImageUri;
  readonly testId?: string;
}

type Styles = ReturnType<typeof createStyles>;

function AttachmentImage({
  image,
  context,
  resolveImageUri,
  styles,
  testId,
}: {
  image: AgentTimelineImageRef;
  context: AttachmentImageContext;
  resolveImageUri?: ResolveImageUri;
  styles: Styles;
  testId?: string;
}) {
  const model = imageAttachmentViewModel(image, context);
  const uri = model.oversized ? undefined : resolveImageUri?.(image, context);

  if (uri) {
    return (
      <View style={styles.card} testID={testId}>
        <Image
          source={{ uri }}
          accessible
          accessibilityLabel={model.name}
          accessibilityRole="image"
          style={styles.image}
        />
        <Text style={styles.caption}>
          {model.kindLabel}
          {model.sizeLabel ? ` · ${model.sizeLabel}` : ""}
        </Text>
      </View>
    );
  }

  return (
    <Card style={styles.card} accessible accessibilityLabel={model.name} testID={testId}>
      <Text style={styles.name} numberOfLines={2}>
        {model.name}
      </Text>
      <Text style={styles.meta}>{model.note}</Text>
    </Card>
  );
}

/**
 * Renders every image on one message entry, bounded and accessible
 * (T33A5). Returns `null` for an entry with no images (the common case)
 * so callers can render this unconditionally, exactly as web's
 * `MessageAttachments` does.
 */
export function MessageAttachments({
  images,
  entryId,
  speaker,
  resolveImageUri,
  testId,
}: MessageAttachmentsProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (images.length === 0) {
    return null;
  }

  const { visible, hiddenCount } = boundImages(images, MAX_IMAGES_PER_ENTRY);
  const groupLabel = imageGroupAccessibilityLabel(speaker, images.length);

  return (
    <View style={styles.group} accessible accessibilityLabel={groupLabel} testID={testId}>
      {visible.map((image, index) => (
        <AttachmentImage
          key={`${entryId}-image-${index}`}
          image={image}
          context={{ entryId, speaker, index, total: images.length }}
          resolveImageUri={resolveImageUri}
          styles={styles}
          testId={testId ? `${testId}-${index}` : undefined}
        />
      ))}
      {hiddenCount > 0 ? (
        <Text style={styles.meta}>
          {hiddenCount} more image{hiddenCount === 1 ? "" : "s"} not shown
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    group: { gap: theme.spacing[2] },
    card: { gap: theme.spacing[1] },
    image: {
      width: "100%",
      height: 160,
      borderRadius: theme.radii.control,
      backgroundColor: theme.colors.surface,
    },
    name: {
      color: theme.colors.ink,
      fontFamily: theme.typography.variant.label.fontFamily,
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
    caption: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    meta: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default MessageAttachments;
