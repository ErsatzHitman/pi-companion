/**
 * plan.md §9.2 host/session header — view model (T33A1).
 *
 * Pure mapping from session identity (host label, session/agent title)
 * plus the shared `TranscriptStatus` (`./status-model.ts`) to the strings
 * `header.tsx` renders. Split out from the component for the same reason
 * as `status-model.ts`: no React Native import, so it is directly
 * unit-testable under this workspace's plain `vitest` setup.
 */
import { buildTranscriptStatusViewModel, type TranscriptStatus } from "./status-model";
import type { StatusTone } from "../../ui/primitives";

export interface TranscriptHeaderInput {
  /** Host/server display name, e.g. "macbook-pro.local". */
  hostLabel: string;
  /** Session/agent display title. Falls back to a placeholder when blank. */
  sessionTitle: string;
  status: TranscriptStatus;
  statusDetail?: string;
}

export interface TranscriptHeaderViewModel {
  title: string;
  subtitle: string;
  tone: StatusTone;
  /** Short status word shown on the header's status chip. */
  chipLabel: string;
  /** Full sentence for the header's live-region accessibility label. */
  accessibilityLabel: string;
}

const UNTITLED_SESSION = "Untitled session";

export function buildTranscriptHeaderViewModel({
  hostLabel,
  sessionTitle,
  status,
  statusDetail,
}: TranscriptHeaderInput): TranscriptHeaderViewModel {
  const title = sessionTitle.trim().length > 0 ? sessionTitle : UNTITLED_SESSION;
  const subtitle = hostLabel;
  const statusModel = buildTranscriptStatusViewModel(status, statusDetail);

  return {
    title,
    subtitle,
    tone: statusModel.tone,
    chipLabel: statusModel.statusText,
    accessibilityLabel: `${title}, on ${subtitle}. ${statusModel.statusText}.`,
  };
}
