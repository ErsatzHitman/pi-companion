import { useMemo, useState } from "react";
import { StyleSheet, Text } from "react-native";

import { Banner } from "../../ui/primitives/Banner";
import { Button } from "../../ui/primitives/Button";
import { Card } from "../../ui/primitives/Card";
import { Section } from "../../ui/primitives/Section";
import { Select } from "../../ui/primitives/Select";
import { TextField } from "../../ui/primitives/TextField";
import { useTheme } from "../../ui/theme/theme-context";
import {
  ADDRESS_FIELD_HINT,
  buildErrorSummaryMessage,
  buildProfileSelectOptions,
  NEW_PROFILE_ID,
  validateConnectForm,
  type ConnectFormFieldErrors,
  type ConnectFormValidation,
  type ConnectProfileOption,
} from "./connect-form-model";

export interface ConnectFormProps {
  /**
   * Saved profiles to offer alongside "New profile". Empty by default —
   * this task owns no storage adapter (see `connect-form-model.ts`'s
   * module docstring), so a caller only ever passes a real list once a
   * later task wires one in.
   */
  profiles?: readonly ConnectProfileOption[];
  /**
   * Called with the validated result once the user submits successfully.
   * This screen only collects and validates input — attempting the
   * connection and persisting anything (SecureStore, AsyncStorage) is
   * later tasks' work (T32A2+), so this prop is optional and a
   * production caller with nothing to do yet may omit it.
   */
  onSubmit?: (result: Extract<ConnectFormValidation, { ok: true }>) => void;
  testId?: string;
}

/**
 * The `/connect` screen's form (plan.md §9.2, T32A1): pick a profile —
 * an already-known one, or "New profile" to enter a fresh `ws://`/
 * `wss://` address — then submit. All touch targets come from the
 * `Select`/`TextField`/`Button` primitives, which already declare a
 * 48dp minimum (`../../ui/primitives/touch-targets.test.ts`); this file
 * adds no touchable of its own. Every validation rule and every
 * accessibility string lives in `connect-form-model.ts` and is unit
 * tested there — this component only wires the model's output onto RN
 * elements' `accessibilityLabel`/`accessibilityHint`/
 * `accessibilityLiveRegion` props.
 *
 * TalkBack: `TextField.error` already folds a field's error into that
 * field's own `accessibilityLabel` (e.g. "Host address. Port must be a
 * number, like ws://192.168.1.10:6767.") and announces it live
 * (`accessibilityLiveRegion="polite"`) the moment it appears; the
 * address field also always carries `ADDRESS_FIELD_HINT` as its
 * `accessibilityHint`, independent of any error, so the expected format
 * is announced before a mistake is even made. A failed submit
 * additionally raises a single `Banner` (also `accessibilityLiveRegion=
 * "polite"`) summarizing every current error, so TalkBack gets one
 * unambiguous announcement even when more than one field is invalid at
 * once. On-device announcement is unverified here (no emulator in this
 * workspace); render proof belongs to the T37 Maestro flows.
 */
export function ConnectForm({ profiles = [], onSubmit, testId }: ConnectFormProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [profileId, setProfileId] = useState<string>(NEW_PROFILE_ID);
  const [profileName, setProfileName] = useState("");
  const [address, setAddress] = useState("");
  const [errors, setErrors] = useState<ConnectFormFieldErrors>({});

  const profileOptions = useMemo(() => buildProfileSelectOptions(profiles), [profiles]);
  const isNewProfile = profileId === NEW_PROFILE_ID;
  const selectedProfile = profiles.find((profile) => profile.id === profileId);
  const summary = buildErrorSummaryMessage(errors);

  function handleProfileChange(nextId: string): void {
    setProfileId(nextId);
    setErrors((previous) => ({ ...previous, profileId: undefined }));
  }

  function handleAddressChange(nextAddress: string): void {
    setAddress(nextAddress);
    setErrors((previous) => ({ ...previous, address: undefined }));
  }

  function handleSubmit(): void {
    const result = validateConnectForm({ profileId, profileName, address }, profiles);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit?.(result);
  }

  return (
    <Section title="Connect to a host" testId={testId}>
      <Card style={styles.card}>
        <Select
          label="Profile"
          options={profileOptions}
          value={profileId}
          onValueChange={handleProfileChange}
          testId={testId ? `${testId}-profile-select` : undefined}
        />
        {isNewProfile ? (
          <>
            <TextField
              label="Profile name"
              value={profileName}
              onChangeText={setProfileName}
              placeholder="My daemon"
              autoCapitalize="none"
              autoCorrect={false}
              testId={testId ? `${testId}-name-field` : undefined}
            />
            <TextField
              label="Host address"
              value={address}
              onChangeText={handleAddressChange}
              placeholder="ws://192.168.1.10:6767"
              error={errors.address}
              required
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              keyboardType="url"
              accessibilityHint={ADDRESS_FIELD_HINT}
              testId={testId ? `${testId}-address-field` : undefined}
            />
          </>
        ) : (
          <Text style={styles.existingNote}>
            {selectedProfile
              ? `Connects using the saved address for ${selectedProfile.label}.`
              : "Select a profile to continue."}
          </Text>
        )}
        {summary ? (
          <Banner
            tone="danger"
            message={summary}
            testId={testId ? `${testId}-error-banner` : undefined}
          />
        ) : null}
        <Button
          kind="primary"
          label={isNewProfile ? "Add host" : "Use this profile"}
          onPress={handleSubmit}
          testId={testId ? `${testId}-submit-button` : undefined}
        />
      </Card>
    </Section>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    card: { gap: theme.spacing[3] },
    existingNote: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.body.fontSize,
    },
  });
}

export default ConnectForm;
