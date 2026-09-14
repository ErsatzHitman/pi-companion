import { Button } from "../../ui/primitives/index.js";
import type { DiscoveredSession } from "./discovered-sessions-client.js";

import "./discovered-session-list.css";

export interface DiscoveredSessionRowProps {
  session: DiscoveredSession;
  /** True while this row's own import request is in flight (T27B5). */
  importing?: boolean;
  onImport: (session: DiscoveredSession) => void;
}

/**
 * A single discovered-session row (T27B5, plan.md §8.3, restyled at
 * UI-W13 to the same row grammar `SessionRow`/`SessionRail` use — a
 * mono glyph, title, and mono meta line, with hairline separators
 * between rows instead of an individually dashed-bordered box.
 * Deliberately not a `SessionRow`: a discovered session has no agent to
 * open yet — its only action is "Import" — so this still renders as
 * plain content plus one `Button`, not a clickable row, keeping
 * "discovered" and "imported" visually and structurally distinct (this
 * task's first acceptance criterion). The glyph is decorative
 * (`aria-hidden`, a discovered session has no `SessionStatus` to encode
 * via `sessionGlyph`) and always reads as the same neutral "not yet
 * imported" mark.
 */
export function DiscoveredSessionRow({
  session,
  importing = false,
  onImport,
}: DiscoveredSessionRowProps) {
  const title = session.title ?? "Untitled Pi session";
  const preview = session.lastPromptPreview ?? session.firstPromptPreview;

  return (
    <li
      className="pc-discovered-session-row"
      data-testid={`discovered-session-row-${session.providerHandleId}`}
    >
      <span className="pc-discovered-session-row__glyph" aria-hidden="true">
        ○
      </span>
      <div className="pc-discovered-session-row__body">
        <span className="pc-discovered-session-row__title">{title}</span>
        <span className="pc-discovered-session-row__meta">
          {session.providerLabel} · {session.cwd}
        </span>
        {preview ? <span className="pc-discovered-session-row__preview">{preview}</span> : null}
      </div>
      <Button
        kind="secondary"
        onClick={() => onImport(session)}
        disabled={importing}
        aria-label={importing ? `Importing ${title}` : `Import ${title}`}
        data-testid={`discovered-session-import-${session.providerHandleId}`}
      >
        {importing ? "Importing…" : "Import"}
      </Button>
    </li>
  );
}
