/**
 * QR pairing state machine — plan.md §7.1/§9.2/§12.1, T32A4 ("Add QR
 * camera pairing").
 *
 * Pure, framework-free control flow for the scan surface: when to ask
 * for camera permission, what to do with a denial, and what happens to
 * one decoded QR payload. Kept free of React Native (like every other
 * `-model.ts`/`*-store.ts` in this feature — `connect-form-model.ts`,
 * `daemon-connection-store.ts`) so every rule below is unit-testable
 * against a scripted `CameraScannerPort` and a scripted
 * `ApplyConnectionOfferAttempt`, never a real camera or emulator.
 * `QrPairingPanel.tsx` is a thin view over this module, exactly the
 * `-model.ts`/`.tsx` split `CLAUDE.md`'s vitest-limitation note asks
 * for.
 *
 * A decoded QR payload is handed to the *same*
 * `apply-connection-offer.ts` pairing pipeline `T32A3` already built —
 * this module changes only how the offer text arrives (a camera decode
 * instead of a pasted link), never how it's parsed or applied. See
 * `apply-connection-offer.ts`'s own docstring for why offer text
 * carries no secret and needs no `credential-store.ts` involvement.
 *
 * ## The permission rule this module exists to get right
 *
 * `enterScanSurface()` is the *only* path that can ever prompt for
 * camera permission, and it is meant to be called exactly when a user
 * actually reaches the scan surface (`QrPairingPanel.tsx`'s mount
 * effect) — never at construction time, and never at app launch.
 * Constructing a controller via `createQrScanController` does nothing
 * by itself; `qr-scan-model.test.ts`'s "does not touch the scanner
 * port until `enterScanSurface()` is called" case proves that directly.
 *
 * Within `enterScanSurface()` (and its explicit-retry sibling,
 * `retryPermission()`), the *native* OS is always the one place a
 * prior denial is remembered — this module never keeps its own
 * "already asked" flag, because a fresh `QrPairingPanel` mount builds
 * a fresh controller every time (leaving and re-entering the scan
 * surface is exactly that: a new mount, a new controller instance).
 * Instead, `enterScanSurface()` always starts by *reading* the current
 * status (`getPermissionStatus()` — never prompts) and only calls the
 * prompting `requestPermission()` when that read comes back
 * `"undetermined"` (never yet asked). A `"denied"`, `"denied-
 * permanently"`, or `"unavailable"` read goes straight to that phase
 * without ever calling `requestPermission()` — so a user who leaves
 * and re-enters the scan surface after declining once is shown the
 * fallback immediately, not re-prompted in a loop. `retryPermission()`
 * is the one deliberate exception: it always calls `requestPermission()`,
 * because it only ever runs from an explicit user gesture (a "Try
 * again" button), not automatically — `QrPairingPanel.tsx` (unowned by
 * this task) only ever renders that button for `"denied"`/
 * `"unavailable"`, never for `"settings"` (see `mapPermissionStatus`'s
 * own comment on why `"denied-permanently"` gets its own phase instead
 * of reusing `"denied"`), so in this build `retryPermission()` is
 * unreachable from `"settings"` — which is correct, and is still true.
 * That loop is now CLOSED: T32A8 (P5-W18) took `QrPairingPanel.tsx` and
 * added a separate "Open settings" button rendered only for the
 * `"settings"` phase, calling an injectable `openSettings` seam
 * (defaulting to React Native's `Linking.openSettings()`) and never
 * `retryPermission()`. Noted here by the P5-W18 merge gate because T32A8
 * could not edit this file.
 */
import type { PermissionState } from "../composer/permission-recovery.js";
import type {
  ApplyConnectionOfferAttempt,
  ApplyConnectionOfferSuccess,
} from "./apply-connection-offer.js";
import type { CameraScannerPort } from "./qr-scanner-port.js";

export type QrScanPhase =
  | "idle"
  | "checking"
  | "ready"
  | "denied"
  | "settings"
  | "unavailable"
  | "pairing"
  | "paired"
  | "error";

export interface QrScanSnapshot {
  phase: QrScanPhase;
  /** The most recent failed pairing attempt's human-readable reason (from `applyOffer`'s `error`). Cleared the moment a new scan starts. Only ever set while `phase === "error"`. */
  error: string | null;
}

const IDLE_SNAPSHOT: QrScanSnapshot = { phase: "idle", error: null };

export type QrScanSnapshotListener = (snapshot: QrScanSnapshot) => void;

export interface QrScanControllerDeps {
  scanner: CameraScannerPort;
  applyOffer: ApplyConnectionOfferAttempt;
  /** Called once, synchronously within `handleScannedText`, the moment a scan pairs successfully — the caller's hook to adopt the resulting lifecycle (e.g. `DaemonConnectionStore.adoptLifecycle`). */
  onPaired: (result: ApplyConnectionOfferSuccess) => void;
}

export interface QrScanController {
  getSnapshot(): QrScanSnapshot;
  subscribe(listener: QrScanSnapshotListener): () => void;
  /**
   * Call once, from the scan surface's mount effect — never from app
   * launch or from constructing this controller. Checks the current
   * permission and, only if it has never been asked, prompts for it
   * once. See this module's docstring for the full rule.
   */
  enterScanSurface(): Promise<void>;
  /** Explicit user retry (a "Try again" button after a denial/unavailable reading) — the only other path that ever calls `requestPermission()`. */
  retryPermission(): Promise<void>;
  /**
   * Feeds one decoded QR payload through `applyOffer`. Ignored while a
   * previous scan is still pairing or has already paired, and
   * de-duplicates an identical payload scanned twice in a row (a
   * camera view fires once per visible frame, so the same code is
   * decoded repeatedly while it stays in frame). A *different* payload
   * — including the same payload scanned again after a failed attempt
   * — is always tried.
   */
  handleScannedText(text: string): Promise<void>;
}

/**
 * `"denied-permanently"` (T60E, P5-W17 — folded onto `PermissionState`
 * from the now-deleted `CameraPermissionStatus`) is Android's own
 * "don't ask again": the OS itself refuses to show its prompt again,
 * so re-requesting is a dead end, exactly as `../composer/permission-
 * recovery.ts`'s own doc comment explains for every other permission
 * in this tree. It therefore maps to its own `"settings"` phase, never
 * to `"denied"` — `"denied"` is what drives `QrPairingPanel.tsx`'s
 * "Try again" retry affordance, and offering that button for a state
 * the OS will silently no-op on would be a lie. Exhaustive over every
 * `PermissionState` member — no `default` branch — so a sixth state
 * added to that union will fail to compile here rather than silently
 * falling through.
 */
function mapPermissionStatus(status: PermissionState): QrScanPhase {
  switch (status) {
    case "granted":
      return "ready";
    case "unavailable":
      return "unavailable";
    case "denied-permanently":
      return "settings";
    case "denied":
    case "undetermined":
      return "denied";
  }
}

export function createQrScanController(deps: QrScanControllerDeps): QrScanController {
  let snapshot: QrScanSnapshot = IDLE_SNAPSHOT;
  const listeners = new Set<QrScanSnapshotListener>();
  let lastScannedText: string | null = null;

  function publish(next: QrScanSnapshot): void {
    snapshot = next;
    for (const listener of listeners) {
      listener(next);
    }
  }

  async function checkThenMaybeRequestOnce(): Promise<void> {
    publish({ phase: "checking", error: null });
    const current = await deps.scanner.getPermissionStatus();
    if (current !== "undetermined") {
      publish({ phase: mapPermissionStatus(current), error: null });
      return;
    }
    const requested = await deps.scanner.requestPermission();
    publish({ phase: mapPermissionStatus(requested), error: null });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    enterScanSurface: checkThenMaybeRequestOnce,
    async retryPermission() {
      publish({ phase: "checking", error: null });
      const requested = await deps.scanner.requestPermission();
      publish({ phase: mapPermissionStatus(requested), error: null });
    },
    async handleScannedText(text) {
      if (snapshot.phase === "pairing" || snapshot.phase === "paired") return;
      if (text === lastScannedText) return;
      lastScannedText = text;
      publish({ phase: "pairing", error: null });

      const result = await deps.applyOffer(text);
      if (!result.ok) {
        // Reset so the *same* text scanned again (e.g. the user fixes
        // nothing and it's re-decoded, or they retry deliberately) is
        // tried again rather than silently ignored forever.
        lastScannedText = null;
        publish({ phase: "error", error: result.error });
        return;
      }

      publish({ phase: "paired", error: null });
      deps.onPaired(result);
    },
  };
}

/** Fixed, non-alarming copy for the scan surface's fallback states — the single source of this text, never re-derived inline in `QrPairingPanel.tsx`. */
export const CAMERA_DENIED_EXPLANATION =
  "Camera access was denied. Enter your host's address manually below instead.";
export const CAMERA_BLOCKED_EXPLANATION =
  "Camera access is blocked. Open system settings to allow it, or enter your host's address manually below instead.";
export const CAMERA_UNAVAILABLE_EXPLANATION =
  "QR pairing isn't available in this build yet. Enter your host's address manually below instead.";

export function describeQrScanPhase(phase: QrScanPhase): string {
  switch (phase) {
    case "checking":
      return "Checking camera access…";
    case "ready":
      return "Point your camera at the pairing QR code.";
    case "denied":
      return CAMERA_DENIED_EXPLANATION;
    case "settings":
      return CAMERA_BLOCKED_EXPLANATION;
    case "unavailable":
      return CAMERA_UNAVAILABLE_EXPLANATION;
    case "pairing":
      return "Pairing…";
    case "paired":
      return "Paired.";
    case "error":
    case "idle":
    default:
      return "";
  }
}
