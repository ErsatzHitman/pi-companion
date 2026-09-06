import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Banner } from "../../ui/primitives/Banner";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/PlaceholderState";
import { Section } from "../../ui/primitives/Section";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import type { ClassifiedShareContent } from "./share-intent-model.js";
import type { ShareChooserState } from "./share-session-chooser.js";

/** One real, nameable destination the chooser can route an accepted share to. */
export interface ShareChooserDestination {
  id: string;
  /** Display label — the route's caller is responsible for the "Untitled session" fallback (`sessions-model.ts`'s own convention), never a raw id shown as if it were a title. */
  title: string;
}

export interface ShareChooserScreenProps {
  state: ShareChooserState;
  /**
   * Real destinations known to the caller — looked up by id for every
   * entry in `state.candidateSessionIds` (the `"choosing"` branch). Kept
   * separate from `state` itself because `ShareChooserState` only ever
   * carries ids (`share-session-chooser.ts`'s own model is intentionally
   * screen-agnostic); a session missing from this list still renders,
   * labelled by its raw id, rather than being silently dropped from the
   * list the user is choosing from.
   */
  destinations: readonly ShareChooserDestination[];
  /** Called with the tapped destination's session id. Never called for a destination not present in `state.candidateSessionIds`. */
  onChoose: (sessionId: string) => void;
  /** Cancels an open chooser, or dismisses the no-sessions state. */
  onDismiss: () => void;
  /** Leaves a terminal (`resolved`/`cancelled`/`invalid-session`) state — e.g. navigating back to the session list. Never called from the `choosing`/`no-sessions`/`idle` branches. */
  onBack: () => void;
  testId?: string;
}

/**
 * The share target chooser screen (T69) — `../../app/share.tsx`'s one
 * child. Purely presentational: every branch below reads directly off
 * `ShareChooserState`'s own named statuses (`share-session-chooser.ts`,
 * T36C) and this component invents no state of its own, so a real
 * `ShareChooserRuntime` (`share-chooser-runtime.ts`) driving `state` is
 * what actually decides which of these renders, never a local guess.
 *
 * Renders shared content only as on-screen text — this component never
 * logs anything (no `console.*` anywhere in this file) and never builds
 * a URL, query string, or navigable `href` out of `state.content`; the
 * one place shared content is ever written anywhere is
 * `share-draft-controller.ts`'s `materializeShareDraft`, already run
 * (through `onChoose` -> the runtime's `resolveChoice`) before this
 * component ever sees a `"resolved"` state.
 */
export function ShareChooserScreen({
  state,
  destinations,
  onChoose,
  onDismiss,
  onBack,
  testId = "share-chooser",
}: ShareChooserScreenProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const titleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const destination of destinations) map.set(destination.id, destination.title);
    return map;
  }, [destinations]);

  if (state.status === "idle") {
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.container}
        testID={`${testId}-idle`}
      >
        <EmptyState
          title="Nothing to share"
          description="Share something into this app from another app to see it here."
        />
      </ScrollView>
    );
  }

  if (state.status === "no-sessions") {
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.container}
        testID={`${testId}-no-sessions`}
      >
        <EmptyState
          title="No sessions to share to yet"
          description="Create a session first, then share into it."
        />
        <Button kind="secondary" label="Dismiss" onPress={onDismiss} testId={`${testId}-dismiss`} />
      </ScrollView>
    );
  }

  if (state.status === "cancelled") {
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.container}
        testID={`${testId}-cancelled`}
      >
        <Banner tone="neutral" message="Share cancelled." testId={`${testId}-cancelled-banner`} />
        <Button kind="secondary" label="Back" onPress={onBack} testId={`${testId}-back`} />
      </ScrollView>
    );
  }

  if (state.status === "invalid-session") {
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.container}
        testID={`${testId}-invalid-session`}
      >
        <Banner
          tone="danger"
          message="That session is no longer available."
          testId={`${testId}-invalid-session-banner`}
        />
        <Button kind="secondary" label="Back" onPress={onBack} testId={`${testId}-back`} />
      </ScrollView>
    );
  }

  if (state.status === "resolved") {
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.container}
        testID={`${testId}-resolved`}
      >
        <Banner
          tone="success"
          message={`Shared into ${titleById.get(state.sessionId) ?? state.sessionId}.`}
          testId={`${testId}-resolved-banner`}
        />
      </ScrollView>
    );
  }

  // state.status === "choosing"
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.container}
      testID={`${testId}-choosing`}
    >
      {state.content.kind === "text" && state.content.looksSecretShaped ? (
        <Banner
          tone="warning"
          message="This looks like it might contain a secret. Double-check before sharing it."
          testId={`${testId}-secret-warning`}
        />
      ) : null}
      <Text style={styles.summary}>{describeShareContent(state.content)}</Text>
      {state.queuedNext ? (
        <Banner
          tone="info"
          message="Another shared item is waiting behind this one."
          testId={`${testId}-queued-next`}
        />
      ) : null}
      <Section title="Choose a session">
        <View style={styles.list} testID={`${testId}-destination-list`}>
          {state.candidateSessionIds.map((sessionId) => (
            <Button
              key={sessionId}
              kind="secondary"
              label={titleById.get(sessionId) ?? sessionId}
              onPress={() => onChoose(sessionId)}
              testId={`${testId}-destination-${sessionId}`}
            />
          ))}
        </View>
      </Section>
      <Button kind="danger" label="Cancel" onPress={onDismiss} testId={`${testId}-cancel`} />
    </ScrollView>
  );
}

function describeShareContent(content: ClassifiedShareContent): string {
  switch (content.kind) {
    case "text":
      return `Text: ${content.text}`;
    case "url":
      return `Link: ${content.url}`;
    case "file":
      return `File: ${content.name}`;
  }
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.canvas },
    container: { padding: theme.spacing[4], gap: theme.spacing[4] },
    list: { gap: theme.spacing[2] },
    summary: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.body.fontWeight),
    },
  });
}
