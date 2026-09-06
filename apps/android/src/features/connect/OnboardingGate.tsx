import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";

import type { KeyValueStorage } from "@picompanion/frontend-core";

import { Banner } from "../../ui/primitives/Banner";
import { Button } from "../../ui/primitives/Button";
import { Card } from "../../ui/primitives/Card";
import { Section } from "../../ui/primitives/Section";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import { createOnboardingController, type OnboardingSnapshot } from "./onboarding-model";
import {
  describePermissionRecovery,
  type OnboardingPermissionsPort,
  type PermissionState,
} from "./onboarding-permissions";
import { createOnboardingPermissionsPort } from "./onboarding-permissions-port";

export interface OnboardingGateProps {
  /** `AppCore.keyValueStorage` — the same plain-storage instance every other durable-preference read in this app uses (`connection-shell.tsx`, `credential-store.ts`'s `plainStorage`). Never `AsyncStorage` directly. */
  storage: KeyValueStorage;
  /** Overridable for tests/alternate builds; defaults to the real `createOnboardingPermissionsPort()` (camera via `qr-scanner-port.ts`, settings via RN `Linking`). */
  permissions?: OnboardingPermissionsPort;
  /** The screen onboarding wraps — in production, `<ConnectionShell />`. Rendered once onboarding's persisted state resolves to `"completed"`; never mounted before then, never replaced by a second connect surface. */
  children: ReactNode;
  testId?: string;
}

/**
 * First-run onboarding (plan.md §9.1/§12.1, T32A6): wraps and sequences
 * the screen a caller passes as `children` — it never renders a second
 * connect form or QR scanner of its own; `ConnectForm`/`QrPairingPanel`
 * stay owned by `ConnectionShell`. All step/permission decision logic
 * lives in `onboarding-model.ts`/`onboarding-permissions.ts`, unit
 * tested there; this component only renders the current phase and
 * forwards button presses.
 *
 * **Mounted** (T32S10, P5-W14): `apps/android/src/app/connect.tsx`
 * renders this component around `ConnectionShell`, passing
 * `AppCore.keyValueStorage` as `storage` and no `permissions` port (so
 * the `createOnboardingPermissionsPort()` default below applies). The
 * seam this comment used to file — "nothing mounts this component yet"
 * — is closed; `connect.test.ts` asserts the wrap directly.
 *
 * Renders nothing while the persisted state is still loading
 * (`phase === "loading"`) rather than flashing a step that might
 * immediately resolve to `"completed"` — the same "don't render the
 * wrong screen first" rule `core-context.tsx`'s `AppCoreProvider`
 * follows for the cold-start profile read.
 */
export function OnboardingGate({ storage, permissions, children, testId }: OnboardingGateProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const controller = useMemo(() => createOnboardingController({ storage }), [storage]);
  const permissionsPort = useMemo(
    () => permissions ?? createOnboardingPermissionsPort(),
    [permissions],
  );

  const [snapshot, setSnapshot] = useState<OnboardingSnapshot>(controller.getSnapshot());
  const [cameraStatus, setCameraStatus] = useState<PermissionState | null>(null);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    void controller.load();
    return unsubscribe;
  }, [controller]);

  useEffect(() => {
    if (snapshot.phase !== "permissions") return;
    let cancelled = false;
    void permissionsPort.getPermissionStatus().then((status) => {
      if (!cancelled) setCameraStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [snapshot.phase, permissionsPort]);

  if (snapshot.phase === "loading") {
    return null;
  }

  if (snapshot.phase === "completed") {
    return <>{children}</>;
  }

  if (snapshot.phase === "welcome") {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.container} testID={testId}>
        <Section title="Welcome to Pi Companion">
          <Card style={styles.card}>
            <Text style={styles.body}>
              Pair with a Pi daemon running on your computer to start a session from your phone.
            </Text>
            <Button
              kind="primary"
              label="Get started"
              onPress={() => void controller.advance()}
              testId={testId ? `${testId}-welcome-continue` : undefined}
            />
          </Card>
        </Section>
      </ScrollView>
    );
  }

  // snapshot.phase === "permissions"
  const recovery = cameraStatus ? describePermissionRecovery("camera", cameraStatus) : null;

  async function handlePrimaryAction(): Promise<void> {
    if (!recovery) return;
    if (recovery.action === "request") {
      const result = await permissionsPort.requestPermission();
      setCameraStatus(result);
      return;
    }
    if (recovery.action === "open-settings") {
      await permissionsPort.openAppSettings();
      return;
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container} testID={testId}>
      <Section title="Camera access">
        <Card style={styles.card}>
          {recovery ? (
            <Banner
              tone={recovery.action === "open-settings" ? "warning" : "info"}
              message={recovery.message}
              testId={testId ? `${testId}-permission-banner` : undefined}
            />
          ) : null}
          {recovery && recovery.action !== "dismiss" ? (
            <Button
              kind="secondary"
              label={recovery.actionLabel}
              onPress={() => void handlePrimaryAction()}
              testId={testId ? `${testId}-permission-primary-action` : undefined}
            />
          ) : null}
          <Button
            kind="primary"
            label="Continue"
            onPress={() => void controller.complete()}
            testId={testId ? `${testId}-permission-continue` : undefined}
          />
        </Card>
      </Section>
    </ScrollView>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.colors.page,
    },
    container: {
      padding: theme.spacing[6],
      gap: theme.spacing[4],
    },
    card: { gap: theme.spacing[3] },
    body: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.body.fontWeight),
    },
  });
}
