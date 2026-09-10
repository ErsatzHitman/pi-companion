import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Banner } from "../../ui/primitives/Banner";
import { Button } from "../../ui/primitives/Button";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import { useKeyboardInset } from "../../app-shell/keyboard-inset";
import { useAppCore } from "../../app/core-context";
import {
  listHostProfiles,
  loadHostProfileSecrets,
  saveHostProfile,
  type HostProfileRecord,
} from "./credential-store";
import { createApplyConnectionOfferAttempt } from "./apply-connection-offer";
import { ConnectForm } from "./ConnectForm";
import { QrPairingPanel } from "./QrPairingPanel";
import { useConnectionStatus } from "./use-connection-status";
import {
  deriveConnectSubmitOutcome,
  deriveReconnectOutcome,
  derivePairingOutcome,
} from "./connection-shell-model";
import { type DaemonConnectionPath, type DaemonConnectionPhase } from "./daemon-connection-store";
import type { ConnectFormValidation, ConnectProfileOption } from "./connect-form-model";
import type { ApplyConnectionOfferSuccess } from "./apply-connection-offer";

/**
 * This app's fixed daemon hello `clientId` (T32A1B). Mirrors
 * `apps/web/src/app/daemon-client-context.tsx`'s
 * `WEB_DAEMON_CLIENT_ID` — a fixed, platform-scoped identity rather
 * than a per-install random id; a later task may replace this with a
 * real per-install id once Android has somewhere durable to keep one
 * (see `credential-store.ts`'s module docstring for why that isn't
 * this task's `plainStorage` seam either).
 *
 * Also mirrors `app-shell/core.ts`'s own copy of this constant, used to
 * build the *direct*-connect attempt behind `AppCore.connection`. This
 * file's copy is used only for the QR/relay-offer attempt below
 * (`createApplyConnectionOfferAttempt`) — a distinct attempt type
 * `AppCore` does not construct on this app's behalf (see
 * `apply-connection-offer.ts`'s module docstring for why the offer path
 * has no saved-profile/app-wide factory yet).
 */
const ANDROID_DAEMON_CLIENT_ID = "picompanion-android";

/**
 * The Android connect shell (plan.md §6/§9.2, §7.1/§12.1,
 * T32A1B/T32A4/T32A5/T32A8): a host/session header, a status strip
 * driven by the *app-wide* `AppCore.connection` store — including,
 * since T32A5, which path ("direct" vs "relay") produced the active
 * connection — the `ConnectForm` that collects and validates a host
 * address, and a QR-pairing entry point (`QrPairingPanel`).
 *
 * **T32A4 fix**: this component used to build its own private
 * `DaemonConnectionStore` in a local `useMemo`, so a successful
 * `ConnectForm` submission never reached `AppCore.connection` —
 * `AppCore.sessionService`'s every method rejected with "Not connected
 * to a daemon" forever, however green the unit tests were (see
 * `app-shell/core.ts`'s `connection`/`sessionService` doc comments,
 * which named this exact gap and this exact fix before it landed). This
 * component now reads `useAppCore().connection` instead of constructing
 * its own generation, so a submission through `ConnectForm` — or a
 * completed QR pairing through `QrPairingPanel` — updates the *same*
 * store every other screen (`session-route-model.ts`,
 * `daemon-session-service.ts`) reads. `AppCore` owns this store's
 * lifetime now (constructed once in `createAppCore()`, for the process
 * lifetime), so this component no longer disposes it on unmount either
 * — unmounting the connect screen after a successful connect must never
 * tear the connection back down.
 *
 * **T32A8 fix**: found at the P5-W16 merge gate — `credential-store.ts`'s
 * `saveHostProfile` had no caller anywhere, and neither `handleSubmit`
 * nor `onPaired` below ever navigated, so `core-context.tsx`'s
 * cold-start restore (`app/index.tsx` reading a stored profile) was
 * unreachable: nothing ever stored one. Both success paths now save the
 * `HostProfileRecord` `connection-shell-model.ts` derives (through
 * `credential-store.ts`'s real `saveHostProfile`, against
 * `useAppCore()`'s real `keyValueStorage`/`secureStorage`) and navigate
 * to that profile's `/h/:serverId/sessions` via `expo-router`'s
 * `useRouter().replace` — `replace`, not `push`, so a completed connect
 * never leaves `/connect` one step back on the stack. A failed direct
 * connect (`deriveConnectSubmitOutcome`'s `"failed"` outcome) saves
 * nothing and navigates nowhere — the existing status strip/`Banner`
 * below is that failure's named, visible state
 * (`connection-shell-model.test.ts` proves the *value* half of this;
 * this file's own source-text test proves it is actually wired here).
 *
 * **T32S14: a saved profile is now reconnectable from the UI.** Until
 * this task `ConnectForm` was only ever given an empty `profiles` list
 * (no earlier task wired a saved-profile source in), so
 * `ConnectFormValidation`'s `"existing"` mode was structurally
 * unreachable — `createReconnectHostProfile` (T66,
 * `host-profile-reconnect.ts`) had zero production callers, exactly the
 * gap that module's own doc comment named. This component now loads the
 * real saved-profile list on mount (`credential-store.ts`'s
 * `listHostProfiles`) and passes it to `ConnectForm`; selecting one and
 * submitting runs `handleReconnect`, which loads that profile's secrets
 * (`loadHostProfileSecrets`), calls `useAppCore().reconnectHostProfile`
 * (`app-shell/core.ts`, T32S14's own AppCore mount of T66's module), and
 * — via `deriveReconnectOutcome` (`connection-shell-model.ts`) — either
 * adopts the reconnected lifecycle and navigates (mirroring
 * `handlePaired` below) or surfaces the failure (including T66's pin-
 * mismatch/pin-missing refusals) through a dedicated `reconnectError`
 * `Banner`, distinct from `handleSubmit`'s own `error` (driven by
 * `useConnectionStatus`) so a reconnect failure is never misattributed
 * to a fresh-connect attempt or vice versa.
 *
 * Wrapped in a `ScrollView` because the form (and, once toggled on, the
 * scan panel) can grow taller than a small device's viewport,
 * particularly once the on-screen keyboard is open.
 */
export function ConnectionShell() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const keyboardInset = useKeyboardInset();
  const { connection: store, keyValueStorage, secureStorage, reconnectHostProfile } = useAppCore();
  const router = useRouter();

  const [showScanner, setShowScanner] = useState(false);
  const [profiles, setProfiles] = useState<readonly HostProfileRecord[]>([]);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  // T32S14: loads the real saved-profile list once on mount, the missing
  // piece that used to leave `ConnectForm` permanently offered an empty
  // `profiles` list — see this component's own doc comment. A profile
  // saved *during* this session (a fresh connect or a completed pairing,
  // both below) is not re-read back in: this list only needs to be
  // fresh enough to offer an *existing* profile to reconnect, and
  // `handleSubmit`/`handlePaired` do not need their own just-saved
  // profile to appear in this same list to work.
  useEffect(() => {
    let cancelled = false;
    void listHostProfiles({ plainStorage: keyValueStorage, secureStorage }).then((loaded) => {
      if (!cancelled) setProfiles(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [keyValueStorage, secureStorage]);

  const profileOptions = useMemo<ConnectProfileOption[]>(
    () => profiles.map((profile) => ({ id: profile.id, label: profile.label })),
    [profiles],
  );

  const applyOffer = useMemo(
    () =>
      createApplyConnectionOfferAttempt({
        clientId: ANDROID_DAEMON_CLIENT_ID,
        clientType: "mobile",
        appVersion: "0.1.0",
      }),
    [],
  );

  const { phase, error, path } = useConnectionStatus(store);

  /**
   * `deriveConnectSubmitOutcome`'s `"connected"` branch saves through the
   * real `saveHostProfile` (never a private write) and always calls
   * `router.replace`, never `router.push` — see this component's own doc
   * comment for why. Its `"failed"` branch calls neither: the existing
   * status strip/`Banner` (driven by `useConnectionStatus(store)` above)
   * is that outcome's visible, named state.
   */
  async function handleSubmit(result: Extract<ConnectFormValidation, { ok: true }>): Promise<void> {
    if (result.mode === "existing") {
      await handleReconnect(result.profile);
      return;
    }
    const attempt = await store.connect(result.draft.parsed);
    const outcome = deriveConnectSubmitOutcome(result.draft, undefined, attempt);
    if (outcome.kind !== "connected") return;
    await saveHostProfile(
      { plainStorage: keyValueStorage, secureStorage },
      outcome.profile,
      outcome.secrets,
    );
    router.replace(outcome.href);
  }

  /**
   * `ConnectForm`'s "existing profile" submit path (T32S14) — the
   * `"existing"` mirror of `handleSubmit`'s own save-then-navigate
   * shape. `selected` (a `ConnectProfileOption`, `{ id, label }` only —
   * `ConnectFormValidation`'s own shape) is resolved back to the full
   * saved `HostProfileRecord` from `profiles` state; a profile removed
   * from storage between load and submit (an edge case no UI here
   * creates yet — there is no "forget profile" affordance) surfaces the
   * same `reconnectError` a live daemon failure would, rather than
   * throwing past this handler.
   */
  async function handleReconnect(selected: ConnectProfileOption): Promise<void> {
    setReconnectError(null);
    const profile = profiles.find((candidate) => candidate.id === selected.id);
    if (!profile) {
      setReconnectError("This saved connection could not be found. Try connecting again.");
      return;
    }
    const secrets = await loadHostProfileSecrets(
      { plainStorage: keyValueStorage, secureStorage },
      profile.id,
    );
    const result = await reconnectHostProfile(profile, secrets);
    const outcome = deriveReconnectOutcome(profile, result);
    if (outcome.kind === "failed") {
      setReconnectError(outcome.error);
      return;
    }
    // P5-W20 merge gate: pass `outcome.path` through. It was already
    // being produced (T66's `ReconnectSuccess.path`) and already threaded
    // here (`deriveReconnectOutcome`), but dropped at this one call site,
    // so a reconnected `kind: "direct"` profile was published — and shown
    // on every screen reading the snapshot — as a relay connection.
    //
    // T73: also pass `profile` itself as `adoptLifecycle`'s new third
    // argument — `daemon-connection-store.ts` reconstructs `daemonAddress`
    // from its own `endpoint`/`useTls`/`isIpv6` on the `path === "direct"`
    // branch (ignored on `"relay"`), so a reconnected direct profile now
    // offers a real download origin and probe URL instead of `null`.
    await store.adoptLifecycle(outcome.lifecycle, outcome.path, profile);
    router.replace(outcome.href);
  }

  /**
   * Mirrors `handleSubmit`'s save-then-navigate step for the relay path.
   * `derivePairingOutcome` never reports a failure — see its own doc
   * comment — so, unlike `handleSubmit`, there is no failure branch to
   * skip here.
   */
  async function handlePaired(result: ApplyConnectionOfferSuccess): Promise<void> {
    void store.adoptLifecycle(result.lifecycle);
    setShowScanner(false);
    const outcome = derivePairingOutcome(result);
    await saveHostProfile(
      { plainStorage: keyValueStorage, secureStorage },
      outcome.profile,
      outcome.secrets,
    );
    router.replace(outcome.href);
  }

  return (
    <ScrollView
      // T330: under edge-to-edge the window never shrinks around the IME,
      // so the viewport is shrunk here instead. That is what lets the
      // native ScrollView keep a focused field in view and lets the user
      // scroll to whatever the keyboard would otherwise cover (run
      // 34450130423: after an error banner, "Add host" sat under the
      // keyboard and was unreachable).
      style={[styles.root, { marginBottom: keyboardInset }]}
      contentContainerStyle={styles.container}
      // T329: a ScrollView's default `keyboardShouldPersistTaps="never"`
      // spends the first tap after typing on dismissing the keyboard and
      // never delivers it to the button underneath. Run 34444464068 showed
      // exactly that on every connect-form flow: address typed, "Add host"
      // tapped, keyboard gone, form untouched, no connection attempted.
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Pi Companion</Text>
      <View style={styles.statusStrip}>
        <View style={[styles.statusDot, statusDotStyle(styles, phase)]} />
        <Text style={styles.statusText} accessibilityRole="text">
          {describeConnectionStatus(phase, path)}
        </Text>
      </View>
      <Text style={styles.hint}>No paired host yet. Add one below.</Text>
      {error ? (
        <Banner tone="danger" message={error} testId="connection-shell-error-banner" />
      ) : null}
      {reconnectError ? (
        <Banner
          tone="danger"
          message={reconnectError}
          testId="connection-shell-reconnect-error-banner"
        />
      ) : null}
      {showScanner ? (
        <>
          <QrPairingPanel
            testId="connection-shell-qr-pairing"
            applyOffer={applyOffer}
            onPaired={(result) => void handlePaired(result)}
          />
          <Button
            kind="secondary"
            label="Enter address manually instead"
            onPress={() => setShowScanner(false)}
            testId="connection-shell-hide-scanner-button"
          />
        </>
      ) : (
        <Button
          kind="secondary"
          label="Scan a QR code"
          onPress={() => setShowScanner(true)}
          testId="connection-shell-show-scanner-button"
        />
      )}
      <ConnectForm testId="connect-form" onSubmit={handleSubmit} profiles={profileOptions} />
    </ScrollView>
  );
}

/**
 * TalkBack- and sighted-user-facing copy for the status strip — the
 * single source of this text, never re-derived inline. `path` (T32A5,
 * "Connection path is visible to the user") names *how* a connected or
 * previously-connected daemon was reached: "direct" for a `ConnectForm`
 * submission (`store.connect()`), "relay" for a completed QR/pasted-
 * offer pairing (`store.adoptLifecycle()` — see `daemon-connection-
 * store.ts`'s module docstring). Only appended once there is a path to
 * name — `"connecting"`/`"idle"` never carry a stale one from a prior
 * generation (`daemon-connection-store.ts`'s `connect()` always
 * publishes `path: null` before a new attempt resolves).
 */
function describeConnectionStatus(
  phase: DaemonConnectionPhase,
  path: DaemonConnectionPath,
): string {
  const pathSuffix =
    path === "direct" ? " via direct connection" : path === "relay" ? " via relay" : "";
  switch (phase) {
    case "connected":
      return `Connected${pathSuffix}`;
    case "connecting":
      return "Connecting…";
    case "disconnected":
      return `Disconnected${pathSuffix}`;
    case "disposed":
      return "Disconnected";
    case "idle":
    default:
      return "Not connected";
  }
}

function statusDotStyle(styles: ReturnType<typeof createStyles>, phase: DaemonConnectionPhase) {
  return phase === "connected" ? styles.statusDotConnected : styles.statusDotDisconnected;
}

/**
 * Every colour here resolves through the `NativeTheme` from
 * `@picompanion/design-tokens` (plan.md §10.2). No raw hex literal may
 * appear in a product surface under `apps/android/src`.
 */
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
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.title.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.title.fontWeight),
    },
    statusStrip: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    statusDot: {
      width: 10,
      height: 10,
      borderRadius: theme.radii.full,
    },
    statusDotConnected: {
      backgroundColor: theme.colors.status.success.icon,
    },
    statusDotDisconnected: {
      backgroundColor: theme.colors.status.danger.icon,
    },
    statusText: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    hint: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.label.fontSize,
    },
  });
}
