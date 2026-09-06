/**
 * Diagnostics export download plumbing (T41B2). Wires
 * `diagnostics-export.ts`'s pure `buildDiagnosticsExportBundle` to a
 * real browser download — Blob, object URL, anchor click — kept out of
 * the model file deliberately (see `diagnostics-export.ts`'s header
 * comment on why that module stays framework-neutral).
 *
 * A `DiagnosticsExportRedactionError` from the model is never swallowed
 * or downgraded to a console warning: it becomes this hook's `"error"`
 * status, and no download is attempted. This is the "a silent no-op is
 * worse than a visible failure" rule applied to export the same way
 * `CopyableField.tsx` applies it to copy.
 */
import { useCallback, useState } from "react";

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
  /** Defaults to `() => new Date().toISOString()`; overridable for deterministic tests. */
  now?: () => string;
  /** Triggers a browser save of the bundle's bytes. Defaults to a real Blob-URL anchor click; overridable for tests. */
  saveBlob?: (bytes: Uint8Array, fileName: string, mimeType: string) => void;
}

export interface DiagnosticsExportController {
  state: DiagnosticsExportState;
  exportNow: () => void;
}

const IDLE_STATE: DiagnosticsExportState = { status: "idle", error: null };

/** Real save path: a same-tab Blob-URL anchor click — matches `apps/web/src/features/files/use-file-download.ts`'s `saveBlobViaAnchor` convention (not imported: that module belongs to a different task's owned directory). */
function saveDiagnosticsExportViaAnchor(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function explainExportFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useDiagnosticsExport(
  options: UseDiagnosticsExportOptions,
): DiagnosticsExportController {
  const {
    sections,
    meta,
    now = () => new Date().toISOString(),
    saveBlob = saveDiagnosticsExportViaAnchor,
  } = options;
  const [state, setState] = useState<DiagnosticsExportState>(IDLE_STATE);

  const exportNow = useCallback(() => {
    try {
      const bundle = buildDiagnosticsExportBundle(sections, { ...meta, exportedAt: now() });
      const json = serializeDiagnosticsExportBundle(bundle);
      const bytes = new TextEncoder().encode(json);
      const fileName = `pi-companion-diagnostics-${bundle.exportedAt.replace(/[^0-9]/g, "")}.json`;
      saveBlob(bytes, fileName, "application/json");
      setState({ status: "success", error: null });
    } catch (error) {
      setState({ status: "error", error: explainExportFailure(error) });
    }
  }, [sections, meta, now, saveBlob]);

  return { state, exportNow };
}
