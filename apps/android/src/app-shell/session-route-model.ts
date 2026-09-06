import type { DaemonConnectionPhase } from "../features/connect/daemon-connection-store.js";
import {
  deriveTranscriptStatus,
  type TranscriptStatus,
} from "../features/transcript/status-model.js";

/**
 * Maps this app's live `DaemonConnectionStore` phase (`AppCore.connection`,
 * `./core.ts`) onto the `TranscriptStatus` the session route's
 * `TranscriptHeader`/`TranscriptStatusStrip` render — T32S3, item (6):
 * before this, `h/[serverId]/session/[agentId]/index.tsx` passed a fixed
 * `status="disconnected"` regardless of the real connection. Both halves
 * this composes — `DaemonConnectionStore` (T32A1B) and
 * `deriveTranscriptStatus` (T33A1) — already exist and are already
 * tested on their own; this is the join, kept as its own named,
 * independently-tested function (`session-route-model.test.ts`) rather
 * than an inline `{ connection: phase }` in the route's JSX.
 *
 * Deliberately imports `daemon-connection-store.js`/`status-model.js`
 * directly, not either feature's barrel (`features/connect`/
 * `features/transcript`): both barrels re-export React Native
 * components (`ConnectionShell`, `TranscriptHeader`, ...), which would
 * make this module — and anything that imports it, including this
 * file's own `.test.ts` — fail to import under this workspace's plain
 * `vitest` setup (see `../../CLAUDE.md`'s "VITEST LIMITATION" note).
 * This file and its test stay `react-native`-free by importing only the
 * two source modules the mapping actually needs.
 *
 * NOTE (disclosed gap, see this task's report): `AppCore.connection`
 * (`./core.ts`) is a real, app-wide `DaemonConnectionStore`, but
 * `features/connect/connection-shell.tsx` — outside this task's Owns
 * grant — still constructs its *own* separate store in a local
 * `useMemo` rather than consuming `AppCore.connection`. Until that file
 * is changed to source its store from `AppCore` instead, the phase this
 * function maps is real, live infrastructure that a real connect
 * attempt does not yet feed in production.
 */
export function deriveSessionRouteStatus(phase: DaemonConnectionPhase): TranscriptStatus {
  return deriveTranscriptStatus({ connection: phase });
}
