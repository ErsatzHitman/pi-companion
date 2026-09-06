import { useEffect, useRef, useState } from "react";

import { Banner, LoadingState } from "../../ui/primitives/index.js";
import type { FileDiffResult } from "./file-diff.js";
import "./files.css";

export interface FileDiffViewProps {
  /** The path being diffed, shown in the header. */
  path: string;
  /** The file's last-known-saved text. */
  oldText: string;
  /** The current (unsaved) buffer to compare against `oldText`. */
  newText: string;
  testId?: string;
}

type FileDiffLoadState =
  | { status: "loading" }
  | { status: "ready"; result: FileDiffResult }
  | { status: "error" };

/**
 * Renders the diff between a file's last-saved text and its current
 * edit buffer (T30B6, plan.md §12.4). `file-diff.ts` — the actual Myers
 * diff algorithm — is dynamically imported inside this component's
 * mount effect exactly the way `file-code-editor.tsx` lazily imports
 * `@codemirror/*`, so it lands in its own bundle chunk rather than the
 * session route's initial JavaScript (T30B6's "the diff chunk is
 * lazily loaded" acceptance criterion, plan.md §14.5).
 *
 * `oldText`/`newText` are recomputed on every prop change (unlike
 * `FileCodeEditor`, which intentionally freezes its initial value):
 * there is no cursor or undo history to protect here, only a derived,
 * read-only comparison.
 */
export function FileDiffView({ path, oldText, newText, testId }: FileDiffViewProps) {
  const [state, setState] = useState<FileDiffLoadState>({ status: "loading" });
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState({ status: "loading" });

    import("./file-diff.js")
      .then(({ computeFileDiff }) => {
        if (requestRef.current !== requestId) return;
        setState({ status: "ready", result: computeFileDiff(oldText, newText) });
      })
      .catch(() => {
        if (requestRef.current !== requestId) return;
        setState({ status: "error" });
      });
  }, [oldText, newText]);

  if (state.status === "loading") {
    return (
      <div className="pc-file-diff" data-testid={testId}>
        <LoadingState
          title="Comparing…"
          description={`Computing changes to ${path}`}
          testId={testId ? `${testId}-loading` : undefined}
        />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="pc-file-diff" data-testid={testId}>
        <Banner
          tone="danger"
          message={`Could not compute a diff for ${path}.`}
          testId={testId ? `${testId}-error` : undefined}
        />
      </div>
    );
  }

  const { result } = state;

  return (
    <div className="pc-file-diff" data-testid={testId}>
      <div className="pc-file-diff__header">
        <span className="pc-file-diff__path">{path}</span>
        <span
          className="pc-file-diff__stat pc-file-diff__stat--added"
          aria-label={`${result.additions} lines added`}
        >
          +{result.additions}
        </span>
        <span
          className="pc-file-diff__stat pc-file-diff__stat--removed"
          aria-label={`${result.deletions} lines removed`}
        >
          -{result.deletions}
        </span>
      </div>
      {result.identical ? (
        <p className="pc-file-diff__empty" data-testid={testId ? `${testId}-empty` : undefined}>
          No changes yet.
        </p>
      ) : (
        <div className="pc-file-diff__body" data-testid={testId ? `${testId}-body` : undefined}>
          {result.chunks.map((chunk, chunkIndex) => (
            // eslint-disable-next-line react/no-array-index-key -- chunks have no stable identity of their own
            <div className="pc-file-diff__chunk" key={chunkIndex}>
              {chunk.skippedBefore > 0 ? (
                <div className="pc-file-diff__skip">
                  {chunk.skippedBefore} unchanged line{chunk.skippedBefore === 1 ? "" : "s"} not
                  shown
                </div>
              ) : null}
              {chunk.lines.map((line, lineIndex) => (
                <div
                  // eslint-disable-next-line react/no-array-index-key -- diff lines have no stable identity of their own
                  key={lineIndex}
                  className={`pc-file-diff__line pc-file-diff__line--${line.type}`}
                >
                  <span className="pc-file-diff__gutter" aria-hidden="true">
                    <span className="pc-file-diff__gutter-old">{line.oldLineNumber ?? ""}</span>
                    <span className="pc-file-diff__gutter-new">{line.newLineNumber ?? ""}</span>
                  </span>
                  <span className="pc-file-diff__marker" aria-hidden="true">
                    {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                  </span>
                  <span className="pc-file-diff__text">
                    {line.text}
                    {line.type === "add" ? (
                      <span className="pc-visually-hidden"> (added line)</span>
                    ) : line.type === "remove" ? (
                      <span className="pc-visually-hidden"> (removed line)</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {result.truncated ? (
        <Banner
          tone="info"
          message="This diff is large; showing a bounded portion rather than the whole thing."
          testId={testId ? `${testId}-truncated` : undefined}
        />
      ) : null}
    </div>
  );
}
