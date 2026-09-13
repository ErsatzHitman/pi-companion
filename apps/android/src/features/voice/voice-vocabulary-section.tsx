import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text } from "react-native";

import type { KeyValueStorage } from "@picompanion/frontend-core";

import { Banner } from "../../ui/primitives/Banner";
import { Button } from "../../ui/primitives/Button";
import { Card } from "../../ui/primitives/Card";
import { Chip, ChipGroup } from "../../ui/primitives/Chip";
import { Section } from "../../ui/primitives/Section";
import { TextField } from "../../ui/primitives/TextField";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import {
  createVoiceVocabularyController,
  MAX_VOICE_VOCABULARY_ENTRIES,
  MAX_VOICE_VOCABULARY_ENTRY_LENGTH,
  type VoiceVocabularyAddResult,
  type VoiceVocabularySnapshot,
} from "./voice-vocabulary-model";

export interface VoiceVocabularySectionProps {
  /**
   * `AppCore.keyValueStorage` — the same instance `SettingsScreen`
   * already receives. The vocabulary lives under its own key
   * (`VOICE_VOCABULARY_STORAGE_KEY`), never inside the settings
   * envelope, so neither store can corrupt the other.
   */
  storage: KeyValueStorage;
  testId?: string;
}

/**
 * Copy for each `addWord` rejection — mirrors the model's own reason
 * union one-to-one, so no failure ever renders a generic "couldn't
 * save". Shown through `TextField`'s own `error` slot, which folds it
 * into the input's accessible name for TalkBack as well as visible
 * text (that primitive's contract, not a second one declared here).
 */
function describeAddFailure(result: Extract<VoiceVocabularyAddResult, { added: false }>): string {
  switch (result.reason) {
    case "empty":
      return "Type a word or phrase first.";
    case "duplicate":
      return "That word is already in the list.";
    case "too-long":
      return `Keep entries under ${MAX_VOICE_VOCABULARY_ENTRY_LENGTH} characters.`;
    case "full":
      return `The list is full (${MAX_VOICE_VOCABULARY_ENTRIES} words). Remove one to add another.`;
  }
}

/**
 * The voice vocabulary section of `../settings/SettingsScreen.tsx`.
 * A thin view over `createVoiceVocabularyController` — all
 * persistence/validation logic lives in `voice-vocabulary-model.ts`,
 * unit tested there; this component only renders the current snapshot
 * and forwards add/remove presses, mirroring `SettingsScreen.tsx`'s
 * own controller/view split over `settings-model.ts`.
 *
 * The entry field sets `autoCapitalize="none"` + `autoCorrect={false}`
 * deliberately: the whole point of a saved entry is its exact casing
 * ("macOS", "iPhone"), and the OS keyboard rewriting that on the way
 * in would corrupt the canonical spelling before it is even saved.
 *
 * **Wired end to end:** saving words here persists them, the session
 * route threads the stored list into the voice controller via
 * `ComposerProps.vocabulary`, and `voice-model.ts` applies it as the
 * post-cleanup repair pass on every transcription.
 */
export function VoiceVocabularySection({ storage, testId }: VoiceVocabularySectionProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const controller = useMemo(() => createVoiceVocabularyController({ storage }), [storage]);
  const [snapshot, setSnapshot] = useState<VoiceVocabularySnapshot>(controller.getSnapshot());
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    void controller.load();
    return unsubscribe;
  }, [controller]);

  async function handleAdd(): Promise<void> {
    const result = await controller.addWord(draft);
    if (result.added) {
      setDraft("");
      setError(null);
    } else {
      setError(describeAddFailure(result));
    }
  }

  return (
    <Section title="Voice" variant="label" testId={testId ? `${testId}-section` : undefined}>
      <Card style={styles.card}>
        {snapshot.loadError ? (
          <Banner
            tone="info"
            message="Couldn't read your saved vocabulary, so the list starts empty."
            testId={testId ? `${testId}-load-error` : undefined}
          />
        ) : null}
        <Text style={styles.hint}>
          Names and project words transcription keeps getting wrong. They are matched whole-word,
          ignoring capitalisation, and rewritten exactly as saved here.
        </Text>
        <TextField
          label="New word or phrase"
          value={draft}
          onChangeText={(value) => {
            setDraft(value);
            if (error !== null) setError(null);
          }}
          placeholder="e.g. Kubernetes"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void handleAdd()}
          error={error ?? undefined}
          testId={testId ? `${testId}-input` : undefined}
        />
        <Button
          label="Add"
          onPress={() => void handleAdd()}
          disabled={draft.trim().length === 0}
          testId={testId ? `${testId}-add` : undefined}
        />
        {snapshot.words.length > 0 ? (
          <ChipGroup accessibleName="Voice vocabulary words">
            {snapshot.words.map((word, index) => (
              <Chip
                key={word.toLowerCase()}
                label={word}
                onRemove={() => void controller.removeWord(word)}
                testId={testId ? `${testId}-word-${index}` : undefined}
              />
            ))}
          </ChipGroup>
        ) : (
          <Text style={styles.empty}>No custom words yet. Saved words appear here.</Text>
        )}
      </Card>
    </Section>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    card: { gap: theme.spacing[3] },
    hint: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.body.fontWeight),
    },
    empty: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}
