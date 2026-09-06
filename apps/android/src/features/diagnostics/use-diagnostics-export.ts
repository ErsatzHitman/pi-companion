/**
 * Diagnostics export share plumbing (T42A3) — Android's counterpart to
 * `apps/web/src/features/diagnostics/use-diagnostics-export.ts`.
 *
 * Web downloads a `.json` file via a Blob/anchor click; Android has no
 * such mechanism (no DOM), so this wires the same redacted, bounded
 * bundle (`diagnostics-export.ts`'s `buildDiagnosticsExportBundle`) to
 * `@picompanion/frontend-core`'s `Sharing.shareText` — a REAL, already
 * installed capability on this app (`../../platform/sharing.ts`'s
 * `createFileSharingUnavailableSharing` over
 * `../../platform/native-share-module.ts`'s `createRNShareModule()`
 * wraps React Native's own `Share.share`, which needs no uninstalled
 * package; see that module's own doc comment). This hook never reaches
 * for `expo-sharing`/`expo-file-system` (both uninstalled and out of
 * this task's scope) — `shareText` alone is enough to hand the whole
 * redacted JSON bundle to the OS share sheet as plain text, which is
 * exactly what `Sharing.shareText`'s type signature promises.
 *
 * A `DiagnosticsExportRedactionError` from the model is never swallowed
 * or downgraded to a console message: it becomes this hook's `"error"`
 * status, and no share is attempted — the "a silent no-op is worse than
 * a visible failure" rule, same as web's hook.
 *
 * Kept RN-free (imports only `react` and a `Sharing` interface, never
 * `react-native` itself) so the state-machine half is provable in plain
 * `vitest` — see `use-diagnostics-export.test.ts`. `DiagnosticsScreen.tsx`
 * is the one production caller, wiring a real `Sharing` in.
 */
import { useCallback, useState } from "react";

import type { Sharing } from "@picompanion/frontend-core";

import {
  buildDiagnosticsExportBundle,
  serializeDiagnosticsExportBundle,
  type DiagnosticsExportMeta,
} from "./diagnostics-export.js";
import type { DiagnosticsSection } from "./diagnostics-model.js";

export type DiagnosticsExportStatus = "idle" | "success" | "error";

export interface DiagnosticsExportState {
  status: DiagnosticsExportStatus;
  /** The reason the export failed; `null` unless `status === "error"`. */
  error: string | null;
}

export interface UseDiagnosticsExportOptions {
  sections: DiagnosticsSection[];
  meta: Omit<DiagnosticsExportMeta, "exportedAt">;
  /** The real Sharing sink this bundle is handed to. */
  sharing: Sharing;
  /** Defaults to `() => new Date().toISOString()`; overridable for deterministic tests. */
  now?: () => string;
}

export interface DiagnosticsExportController {
  state: DiagnosticsExportState;
  exportNow: () => Promise<void>;
}

const IDLE_STATE: DiagnosticsExportState = { status: "idle", error: null };

function explainExportFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useDiagnosticsExport(
  options: UseDiagnosticsExportOptions,
): DiagnosticsExportController {
  const { sections, meta, sharing, now = () => new Date().toISOString() } = options;
  const [state, setState] = useState<DiagnosticsExportState>(IDLE_STATE);

  const exportNow = useCallback(async () => {
    try {
      const bundle = buildDiagnosticsExportBundle(sections, { ...meta, exportedAt: now() });
      const json = serializeDiagnosticsExportBundle(bundle);
      await sharing.shareText(json, { title: "Pi Companion diagnostics" });
      setState({ status: "success", error: null });
    } catch (error) {
      setState({ status: "error", error: explainExportFailure(error) });
    }
  }, [sections, meta, sharing, now]);

  return { state, exportNow };
}
