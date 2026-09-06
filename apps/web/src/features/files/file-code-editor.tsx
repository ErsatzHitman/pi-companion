import { useEffect, useRef } from "react";

import { syntaxHighlightStyleColors } from "./file-syntax-highlight.js";
import "./files.css";

export interface FileCodeEditorProps {
  /** The file's path, used only to pick a `@picompanion/highlight` language grammar. */
  path: string;
  /** The buffer to seed the editor with on mount. Not re-synced after mount — see the module docstring. */
  value: string;
  onChange: (next: string) => void;
  /** Disables typing (e.g. while a save is in flight) without discarding or hiding the buffer. */
  readOnly?: boolean;
  testId?: string;
}

/**
 * A CodeMirror 6 text editor bound to a single file's buffer (T30B3,
 * plan.md §8.4, §12.4). `@codemirror/state`, `@codemirror/view`,
 * `@codemirror/commands`, and `@codemirror/language` are all
 * dynamically imported inside this component's mount effect — the same
 * pattern `terminal-view.tsx` uses for `@xterm/xterm` — so Rollup/Vite
 * splits them into a chunk that is only fetched once a user actually
 * opens the editor (T30B3's "the editor chunk is lazily loaded"
 * acceptance criterion), never as part of the read-only file view or
 * the wider session route.
 *
 * `@picompanion/highlight`'s `getLanguageForFile`/
 * `createCodeMirrorHighlightStyle` (`parsers.ts`/
 * `codemirror-highlight-style.ts`) themselves statically need
 * `@codemirror/language`, so this component dynamically imports
 * `@picompanion/highlight` alongside the CodeMirror packages above
 * instead of importing it at this module's top level — the read-only
 * file view (`file-syntax-highlight.ts`) only ever imports this
 * package's `@codemirror/language`-free `highlightCodeLezerOnly`, and
 * this file's own top level must stay equally free of it so nothing
 * statically reaches `@codemirror/language` outside this lazy mount.
 * `getLanguageForFile`/`createCodeMirrorHighlightStyle` still resolve
 * to the exact same parser and `--syntax-*` token colours the
 * read-only view uses, so switching between viewing and editing a
 * file never changes its highlighting.
 *
 * `value` only seeds the initial document. This component does not
 * reconcile a changed `value` prop back into a mounted editor (that
 * would fight the user's cursor/undo history mid-edit); callers that
 * need a fresh buffer — cancelling and re-entering edit mode, or
 * opening a different file — unmount and remount this component instead
 * (`use-file-editor.ts`'s `mode`/`file.path` transitions already do
 * this: `FileEditorPanel` only renders this component while
 * `mode !== "read"`, and `useFileEditor` resets to read mode whenever
 * `file.path` changes).
 */
export function FileCodeEditor({
  path,
  value,
  onChange,
  readOnly = false,
  testId,
}: FileCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    let view: { destroy(): void } | null = null;

    async function mount() {
      const [{ EditorState }, viewModule, commandsModule, languageModule, highlightModule] =
        await Promise.all([
          import("@codemirror/state"),
          import("@codemirror/view"),
          import("@codemirror/commands"),
          import("@codemirror/language"),
          import("@picompanion/highlight"),
        ]);
      if (cancelled) return;
      const container = containerRef.current;
      if (!container) return;

      const { EditorView, keymap, lineNumbers, highlightActiveLine } = viewModule;
      const { defaultKeymap, history, historyKeymap, indentWithTab } = commandsModule;
      const { syntaxHighlighting, indentOnInput, bracketMatching } = languageModule;
      const { getLanguageForFile, createCodeMirrorHighlightStyle } = highlightModule;

      const language = getLanguageForFile(path);
      const highlightStyle = createCodeMirrorHighlightStyle(syntaxHighlightStyleColors());

      const extensions = [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        indentOnInput(),
        bracketMatching(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        syntaxHighlighting(highlightStyle),
        EditorView.lineWrapping,
        EditorView.editable.of(!readOnly),
        EditorView.contentAttributes.of({
          "aria-label": `Edit ${path}`,
          ...(testId ? { "data-testid": `${testId}-content` } : {}),
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        ...(language ? [language] : []),
      ];

      const editorView = new EditorView({
        state: EditorState.create({ doc: value, extensions }),
        parent: container,
      });
      view = editorView;
    }

    void mount();

    return () => {
      cancelled = true;
      view?.destroy();
    };
    // `value` and `onChange` are intentionally excluded: `value` only
    // seeds the initial document (see the module docstring above) and
    // `onChange` is read through `onChangeRef` so it never forces a
    // remount (and the loss of undo history that would cause).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, readOnly]);

  return <div ref={containerRef} className="pc-file-editor__code" data-testid={testId} />;
}
