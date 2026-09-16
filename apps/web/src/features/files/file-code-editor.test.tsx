import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * WEB-FILES-1: a real layout assertion (does a 5000-line file grow the
 * page, does the editor get its own scrollbar) is not something this
 * suite can see — jsdom never runs layout, and the `@codemirror/*`
 * modules are faked above (see the module docstring) precisely because
 * real CodeMirror needs measurement APIs jsdom does not provide. What
 * CAN be pinned honestly is the CSS rule itself: that `.pc-file-editor__code`
 * (the element `FileCodeEditor` renders below, and the `.cm-editor` child's
 * `.cm-*` classes are applied to a descendant CodeMirror mounts inside it)
 * is a genuine flex container with a real height bound, so its CodeMirror
 * child's `flex: 1 1 auto; min-height: 0` rule (`files.css`) has something
 * to resolve against instead of being inert.
 *
 * This fails against the pre-fix CSS: SHELL-1 left `.pc-file-editor__code`
 * a plain block box (`border-radius`/`box-shadow`/`overflow` only, no
 * `display` and no height bound at all), which is exactly the regression
 * this task fixes — see `files.css`'s own comment on this rule for the
 * full account.
 */
describe("FileCodeEditor's box has a real bound (WEB-FILES-1)", () => {
  function readFilesCssRule(selector: string): string {
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), "files.css");
    const css = readFileSync(cssPath, "utf8");
    // Matches only the block whose selector is exactly `selector` (nothing
    // but whitespace before the `{`), not a longer descendant selector like
    // `.pc-file-editor__code .cm-editor { ... }` that happens to start with
    // the same text.
    const escaped = selector.replace(/[.#]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    expect(match, `expected a \`${selector} { ... }\` rule in files.css`).toBeTruthy();
    return match![1]!;
  }

  it("makes .pc-file-editor__code a flex container with a real max-height, not an inert flex-child rule on a plain block box", () => {
    const codeBox = readFilesCssRule(".pc-file-editor__code");

    expect(codeBox).toMatch(/display:\s*flex/);
    // Bounded in `dvh` (the dynamic-viewport unit `.shell` itself caps
    // against, `ui/shell.css`'s `height: 100dvh`) rather than the plain
    // `vh` SHELL-1 removed, or no bound at all (today's regression).
    expect(codeBox).toMatch(/max-height:.*dvh/);

    // The `.cm-editor` child rule this box's flex container-ness makes
    // meaningful again: still present, still expecting a flex parent.
    const cmEditor = readFilesCssRule(".pc-file-editor__code .cm-editor");
    expect(cmEditor).toMatch(/flex:\s*1\s+1\s+auto/);
    expect(cmEditor).toMatch(/min-height:\s*0/);
  });

  it("still frames the box with the code-block chrome (radius/shadow/overflow) SHELL-1 didn't touch", () => {
    const codeBox = readFilesCssRule(".pc-file-editor__code");

    expect(codeBox).toMatch(/border-radius:\s*var\(--radius-control\)/);
    expect(codeBox).toMatch(/box-shadow:\s*var\(--shadow-hairline\)/);
    expect(codeBox).toMatch(/overflow:\s*hidden/);
  });
});
