import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileCodeEditor } from "./file-code-editor.js";

/**
 * A fake `@codemirror/*` module set, mirroring `terminal-view.test.tsx`'s
 * fake `@xterm/xterm`: real CodeMirror needs measurement APIs jsdom
 * does not meaningfully provide, so this only exercises `FileCodeEditor`'s
 * wiring (which extensions it builds, that it lazily imports these
 * modules, and that `onChange`/`destroy` round-trip correctly) rather
 * than CodeMirror's own rendering — covered end-to-end by T31C's
 * Playwright harness against a real daemon instead.
 */
const { FakeEditorView, instances } = vi.hoisted(() => {
  class FakeEditorViewImpl {
    static updateListener = {
      of: (fn: (update: unknown) => void) => ({ kind: "updateListener", fn }),
    };
    static editable = { of: (value: boolean) => ({ kind: "editable", value }) };
    static contentAttributes = {
      of: (attrs: Record<string, string>) => ({ kind: "contentAttributes", attrs }),
    };
    static lineWrapping = { kind: "lineWrapping" };
    config: {
      state: { doc: string; extensions: Array<{ kind: string; fn?: (update: unknown) => void }> };
      parent: HTMLElement;
    };
    destroyed = false;
    constructor(config: FakeEditorViewImpl["config"]) {
      this.config = config;
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  const list: FakeEditorViewImpl[] = [];
  class TrackedFakeEditorView extends FakeEditorViewImpl {
    constructor(config: FakeEditorViewImpl["config"]) {
      super(config);
      list.push(this);
    }
  }
  return { FakeEditorView: TrackedFakeEditorView, instances: list };
});

vi.mock("@codemirror/state", () => ({
  EditorState: {
    create: (config: { doc: string; extensions: unknown[] }) => ({
      doc: config.doc,
      extensions: config.extensions,
    }),
  },
}));
vi.mock("@codemirror/view", () => ({
  EditorView: FakeEditorView,
  keymap: { of: (bindings: unknown[]) => ({ kind: "keymap", bindings }) },
  lineNumbers: () => ({ kind: "lineNumbers" }),
  highlightActiveLine: () => ({ kind: "highlightActiveLine" }),
}));
vi.mock("@codemirror/commands", () => ({
  defaultKeymap: [],
  history: () => ({ kind: "history" }),
  historyKeymap: [],
  indentWithTab: { key: "Tab" },
}));
// `@codemirror/language` is intentionally left unmocked: `@picompanion/highlight`
// (loaded by `file-code-editor.tsx` for `getLanguageForFile`/
// `createCodeMirrorHighlightStyle`) imports real `Language`,
// `defineLanguageFacet`, and `StreamLanguage` from it at module scope,
// so a fake without those breaks that import. Its real
// `syntaxHighlighting`/`indentOnInput`/`bracketMatching` are plain,
// DOM-independent functions that just sit inertly in the extension
// array this file inspects below.

afterEach(() => {
  cleanup();
  instances.length = 0;
});

/**
 * Mounting `FileCodeEditor` awaits a dynamic `import()` of the real
 * `@picompanion/highlight` entry point (deliberately unmocked, see
 * above), which pulls in every `@lezer/*` grammar. Under the full
 * `apps/web` suite that first chunk import can comfortably exceed
 * `waitFor`'s 1s default on a loaded machine, so every wait for the
 * mounted view uses the same generous, explicit ceiling
 * `routes/screens/host-session-files-screen.test.tsx` already uses for a
 * first lazy-route chunk import. In isolation these resolve in
 * milliseconds; the ceiling only prevents a load-dependent flake.
 */
const LAZY_IMPORT_WAIT = { timeout: 15_000 } as const;

function findExtension(view: (typeof instances)[number], kind: string) {
  return view.config.state.extensions.find((extension) => extension.kind === kind);
}

describe("FileCodeEditor (T30B3)", () => {
  it("lazily imports the CodeMirror modules and mounts an editor seeded with the initial value", async () => {
    render(
      <FileCodeEditor
        path="src/index.ts"
        value="const x = 1;"
        onChange={vi.fn()}
        testId="editor"
      />,
    );

    await waitFor(() => expect(instances).toHaveLength(1), LAZY_IMPORT_WAIT);
    expect(instances[0]?.config.state.doc).toBe("const x = 1;");
    expect(instances[0]?.config.parent).toBeInstanceOf(HTMLElement);
  }, 20_000);

  it("reports document changes through onChange", async () => {
    const onChange = vi.fn();
    render(
      <FileCodeEditor
        path="src/index.ts"
        value="const x = 1;"
        onChange={onChange}
        testId="editor"
      />,
    );
    await waitFor(() => expect(instances).toHaveLength(1), LAZY_IMPORT_WAIT);

    const listener = findExtension(instances[0]!, "updateListener");
    listener?.fn?.({ docChanged: true, state: { doc: { toString: () => "const x = 2;" } } });

    expect(onChange).toHaveBeenCalledWith("const x = 2;");
  }, 20_000);

  it("ignores updates that did not change the document", async () => {
    const onChange = vi.fn();
    render(
      <FileCodeEditor
        path="src/index.ts"
        value="const x = 1;"
        onChange={onChange}
        testId="editor"
      />,
    );
    await waitFor(() => expect(instances).toHaveLength(1), LAZY_IMPORT_WAIT);

    const listener = findExtension(instances[0]!, "updateListener");
    listener?.fn?.({ docChanged: false, state: { doc: { toString: () => "const x = 1;" } } });

    expect(onChange).not.toHaveBeenCalled();
  }, 20_000);

  it("marks the content non-editable when readOnly is set", async () => {
    render(
      <FileCodeEditor
        path="src/index.ts"
        value="const x = 1;"
        onChange={vi.fn()}
        readOnly
        testId="editor"
      />,
    );
    await waitFor(() => expect(instances).toHaveLength(1), LAZY_IMPORT_WAIT);

    const editable = findExtension(instances[0]!, "editable") as { value?: boolean } | undefined;
    expect(editable?.value).toBe(false);
  }, 20_000);

  it("gives the content region an accessible label naming the file", async () => {
    render(<FileCodeEditor path="src/notes.md" value="hello" onChange={vi.fn()} testId="editor" />);
    await waitFor(() => expect(instances).toHaveLength(1), LAZY_IMPORT_WAIT);

    const attrs = findExtension(instances[0]!, "contentAttributes") as
      | { attrs?: Record<string, string> }
      | undefined;
    expect(attrs?.attrs?.["aria-label"]).toBe("Edit src/notes.md");
  }, 20_000);

  it("destroys the editor view on unmount", async () => {
    const { unmount } = render(
      <FileCodeEditor
        path="src/index.ts"
        value="const x = 1;"
        onChange={vi.fn()}
        testId="editor"
      />,
    );
    await waitFor(() => expect(instances).toHaveLength(1), LAZY_IMPORT_WAIT);

    unmount();

    expect(instances[0]?.destroyed).toBe(true);
  }, 20_000);

  it("remounts with a fresh editor when readOnly toggles", async () => {
    const { rerender } = render(
      <FileCodeEditor
        path="src/index.ts"
        value="const x = 1;"
        onChange={vi.fn()}
        testId="editor"
      />,
    );
    await waitFor(() => expect(instances).toHaveLength(1), LAZY_IMPORT_WAIT);

    rerender(
      <FileCodeEditor
        path="src/index.ts"
        value="const x = 1;"
        onChange={vi.fn()}
        readOnly
        testId="editor"
      />,
    );

    await waitFor(() => expect(instances).toHaveLength(2), LAZY_IMPORT_WAIT);
    expect(instances[0]?.destroyed).toBe(true);
  }, 20_000);
});
