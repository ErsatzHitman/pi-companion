import { CodeBlock, EmptyState } from "../../ui/primitives/index.js";
import { formatFileSize, formatModifiedAt } from "./format.js";
import type { FileReadResult } from "./file-read-client.js";
import { explainRefusedFileKind } from "./file-read-client.js";
import { syntaxClassName, tokenizeFileContent } from "./file-syntax-highlight.js";
import "./files.css";

export interface FileContentViewProps {
  file: FileReadResult;
}

function extensionLabel(path: string): string | undefined {
  const name = path.split("/").pop() ?? path;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return undefined;
  return name.slice(dotIndex + 1).toLowerCase();
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * The read-only body of the `/h/:serverId/session/:agentId/files/*`
 * screen once `useFileExplorer` resolves the path to a file (T30B2).
 * Text files are tokenized by `@picompanion/highlight` and rendered
 * through the `CodeBlock` primitive (`ui/primitives/CodeBlock.tsx`):
 * `FileTextBody` composes it — passing the per-line, per-token markup as
 * `children` — rather than re-implementing its `.pc-code-block` shell,
 * so this view and every other `CodeBlock` consumer share one
 * `<pre><code>` treatment (plan.md §10.1's "one approved treatment per
 * component"). Binary, image, and oversized files are refused with
 * `EmptyState` rather than dumped as raw bytes or silently truncated.
 */
export function FileContentView({ file }: FileContentViewProps) {
  const refusal = explainRefusedFileKind(file);
  const testId = "file-content-view";

  return (
    <div className="pc-file-content" data-testid={testId}>
      <div className="pc-file-content__meta">
        <span className="pc-file-content__path">{file.path}</span>
        <span className="pc-file-content__meta-item">{formatFileSize(file.size)}</span>
        <span className="pc-file-content__meta-item">{formatModifiedAt(file.modifiedAt)}</span>
      </div>
      {refusal ? (
        <EmptyState
          title={refusal.title}
          description={refusal.description}
          testId="file-content-refused"
        />
      ) : (
        <FileTextBody file={file} />
      )}
    </div>
  );
}

function FileTextBody({ file }: { file: FileReadResult }) {
  const content = decodeText(file.bytes);
  if (content.length === 0) {
    return (
      <EmptyState
        title="This file is empty"
        description="There is nothing to show here yet."
        testId="file-content-empty"
      />
    );
  }

  const language = extensionLabel(file.path);
  const lines = tokenizeFileContent(content, file.path);

  return (
    <CodeBlock code={content} language={language} testId="file-content-code">
      {lines.map((tokens, lineIndex) => (
        // eslint-disable-next-line react/no-array-index-key -- lines are positional and never reordered
        <span key={lineIndex} className="pc-file-content__line">
          {tokens.map((token, tokenIndex) => {
            const className = syntaxClassName(token.style);
            return (
              <span
                // eslint-disable-next-line react/no-array-index-key -- tokens are positional and never reordered
                key={tokenIndex}
                className={className ?? undefined}
              >
                {token.text}
              </span>
            );
          })}
          {lineIndex < lines.length - 1 ? "\n" : null}
        </span>
      ))}
    </CodeBlock>
  );
}
