import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T35A1 source-level coverage for `files-screen.tsx`.
 *
 * `react-native` component modules can't be rendered under this
 * workspace's plain `vitest` setup (see `../sessions/sessions-screen.
 * test.ts`'s identical note), so — exactly like that file — this
 * statically verifies the source contracts a render pass would
 * otherwise check. The real logic (breadcrumbs, sorting, navigation,
 * the three named error states) is unit tested directly in
 * `files-model.test.ts` against an injected fake daemon RPC client.
 */
function readScreenSource(): string {
  return readFileSync(fileURLToPath(new URL("./files-screen.tsx", import.meta.url)), "utf8");
}

/**
 * `readScreenSource` with comments stripped, matching `../sessions/
 * sessions-screen.test.ts`'s `readScreenCode()`/`../transcript/
 * transcript-accessibility.test.ts`'s `readCode()` precedent: this
 * file's own doc comments quote several of the strings the assertions
 * below look for (e.g. `fs`, `EmptyState`), so an unanchored regex over
 * the raw file text can stay green after the real construct is deleted.
 * Assertions that must reach actual code read through this instead of
 * `readScreenSource()`.
 */
function readScreenCode(): string {
  return readScreenSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("FilesScreen source", () => {
  const source = readScreenSource();
  const code = readScreenCode();

  it("never imports a local filesystem API — all access goes through the injected daemon RPC client", () => {
    // No `fs`/`node:fs`, no `expo-file-system`, no bare "path" module.
    expect(code).not.toMatch(/from\s+["']node:fs["']/);
    expect(code).not.toMatch(/from\s+["']fs["']/);
    expect(code).not.toMatch(/from\s+["']expo-file-system["']/);
    expect(code).not.toMatch(/from\s+["']path["']/);
    expect(code).not.toMatch(/from\s+["']node:path["']/);
    // The only file-listing seam is the injected client's `FileBrowserClient` type/import.
    expect(code).toMatch(/from\s+["']\.\/files-model["']/);
  });

  it("renders its own full scroll surface rather than assuming a sibling transcript pane", () => {
    expect(code).toMatch(/<ScrollView\b/);
    // No split/pane/sidebar layout wrapper that would only make sense
    // alongside another rendered surface.
    expect(code).not.toMatch(/\bChatPane\b/);
    expect(code).not.toMatch(/\bTranscriptPane\b/);
    expect(code).not.toMatch(/\bSplitView\b/);
  });

  it("renders breadcrumbs distinct from the entry list", () => {
    expect(code).toMatch(/\bFilesBreadcrumbRow\b/);
    expect(code).toMatch(/\bbuildFilesBreadcrumbs\b/);
  });

  it("renders all three named error/loading states from the shared PlaceholderState primitives, not hand-rolled", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bEmptyState\b[^}]*\bErrorState\b[^}]*\bLoadingState\b[^}]*\}\s*from\s*"\.\.\/\.\.\/ui\/primitives"/,
    );
    expect(code).toMatch(/<LoadingState\b/);
    // Two distinct <ErrorState> usages: "not connected" and a real listing error.
    expect(code.match(/<ErrorState\b/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(code).toMatch(/<EmptyState\b/);
  });

  it("declares a 48dp row touch target", () => {
    const minDimensions = [...code.matchAll(/minHeight:\s*(\d+)\b/g)].map((match) =>
      Number(match[1]),
    );
    expect(minDimensions.length).toBeGreaterThan(0);
    for (const value of minDimensions) {
      expect(value).toBeGreaterThanOrEqual(48);
    }
  });

  it("gives every folder/file row a combined, textual accessibility label — never colour/icon alone", () => {
    expect(code).toMatch(/accessibilityLabel=\{`\$\{entry\.name\}, \$\{meta\}`\}/);
  });

  it("uses only theme tokens for colour, never a raw hex literal", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).toMatch(/theme\.colors\./);
  });

  // --- T35A2: reading and displaying a file ---

  it("composes the shared CodeBlock primitive for the plain-text case, rather than reimplementing its own copy", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bCodeBlock\b[^}]*\}\s*from\s*"\.\.\/\.\.\/ui\/primitives"/,
    );
    expect(code).toMatch(
      /<CodeBlock\s+code=\{content\}\s+language=\{language\}\s+testId=\{testId\}\s*\/>/,
    );
  });

  it("drives every read through the injected file-view-model controller, never a direct client.readFile call from the screen itself", () => {
    expect(code).toMatch(/from\s+["']\.\/file-view-model["']/);
    expect(code).toMatch(/\bcreateFileViewController\(\{/);
    // Both optional-chained call shapes are in the pattern deliberately.
    // `readFile` is an OPTIONAL member of `FileBrowserClient` — that is the
    // whole reason `core.ts` had to grow a forward for it — so
    // `client.readFile?.(…)` is the natural way someone would write this
    // call site, not an edge case, and a literal `\(` prohibition would
    // never have seen it. A positive assertion that stops matching goes
    // red; a prohibition that stops matching passes silently forever.
    // Not the looser `\??\.?`, which would also match the optional method
    // *signature* `readFile?(cwd: string, path: string)` in an interface.
    expect(code).not.toMatch(/client(?:\?)?\.readFile(?:\?\.)?\(/);
  });

  it("never logs file content or a path, and never puts a path in a URL query string", () => {
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/[?&]path=/);
  });

  it("passes the listing's own entry size as the read's sizeHint, so an oversized file is refused before any RPC", () => {
    expect(code).toMatch(/sizeHint:\s*selectedEntry\.size/);
  });

  // --- T35A3: native editing ---

  it("composes TextArea/Button/Banner for the edit surface, rather than a hand-rolled input", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bBanner\b[^}]*\bButton\b[^}]*\bTextArea\b[^}]*\}\s*from\s*"\.\.\/\.\.\/ui\/primitives"/,
    );
    expect(code).toMatch(/<TextArea\b/);
  });

  it("drives every save through the injected file-edit-model controller, never a direct client.writeFile call from the screen itself", () => {
    expect(code).toMatch(/from\s+["']\.\/file-edit-model["']/);
    expect(code).toMatch(/\bcreateFileEditController\(\{/);
    // `writeFile` is an OPTIONAL member of `FileBrowserClient` (same
    // reason `readFile` above gets the optional-chained-call form, not a
    // literal `\(` prohibition — see that test's comment) — so this
    // matches `client.writeFile?.(…)` too, not just `client.writeFile(`.
    expect(code).not.toMatch(/client(?:\?)?\.writeFile(?:\?\.)?\(/);
  });

  it("binds the edit buffer's value and change handler to the controller, not local component state", () => {
    expect(code).toMatch(/value=\{editState\.buffer\}/);
    expect(code).toMatch(/onChangeText=\{controller\.updateBuffer\}/);
  });

  it("wires Save and Cancel to the controller's save/cancelEditing, and disables both while a save is in flight", () => {
    expect(code).toMatch(/onPress=\{controller\.save\}/);
    expect(code).toMatch(/onPress=\{controller\.cancelEditing\}/);
    expect(
      code.match(/disabled=\{editState\.mode === "saving"\}/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });

  it("always renders the edit limits sentence before an edit is ever started, distinct from the per-file refusal banner", () => {
    expect(code).toMatch(/from\s+["']\.\/file-edit-model["']/);
    expect(code).toMatch(/\bdescribeFileEditLimits\(\)/);
    expect(code).toMatch(/editState\.limitRefusal/);
  });

  it("re-reads the file from the daemon after a confirmed save, rather than locally echoing the edited buffer as the new content", () => {
    // `onSaved` reaches `FileContentView` from `FilesScreen` as
    // `fileController?.retry()` — the same read-side controller
    // `FileTextBody` already renders from, never a second, hand-built
    // "apply this buffer" path.
    expect(code).toMatch(/onSaved=\{\(\)\s*=>\s*fileController\?\.retry\(\)\}/);
  });

  it("adds no new required prop to FilesScreenProps — writeFile is an optional member of the same FileBrowserClient the read path already uses", () => {
    const propsBlock = source.slice(
      source.indexOf("export interface FilesScreenProps"),
      source.indexOf("export function FilesScreen"),
    );
    expect(propsBlock).toMatch(/client\?:\s*FileBrowserClient;/);
  });

  // --- T35A4: upload and download ---

  it("drives every upload through the injected file-upload-model controller, never a direct client.uploadFile call from the screen itself", () => {
    expect(code).toMatch(/from\s+["']\.\/file-upload-model["']/);
    // A full call expression, not a bare identifier the file's own
    // import line would already satisfy (T35A4's `uploadFile` is
    // built once per `(client, filePicker)` pair, matching `fileController`'s own `useMemo` shape).
    expect(code).toMatch(/createFileUploadController\(\{\s*client,\s*filePicker\s*\}\)/);
    // `uploadFile` is an OPTIONAL member of `FileBrowserClient` — matches
    // the same optional-chained-call shape `readFile`'s/`writeFile`'s
    // tests above use, for the same reason (see those tests' comments).
    expect(code).not.toMatch(/client(?:\?)?\.uploadFile(?:\?\.)?\(/);
  });

  it("drives every download through the injected file-download-model controller, never a direct client.requestDownloadToken call from the screen itself", () => {
    expect(code).toMatch(/from\s+["']\.\/file-download-model["']/);
    // T66 added `connectionPath` between `downloadOrigin` and `fetchImpl`
    // (so a relay-paired session's missing origin gets the distinct
    // `FILE_DOWNLOAD_NO_RELAY_ORIGIN` refusal, not the generic one) —
    // this match is anchored to the whole call expression, not a
    // fixed field order a mere reordering would falsely break.
    expect(code).toMatch(
      /createFileDownloadController\(\{\s*client,\s*downloadOrigin:\s*downloadOrigin\s*\?\?\s*null,\s*connectionPath:\s*connectionPath\s*\?\?\s*null,\s*fetchImpl,?\s*\}\)/,
    );
    expect(code).not.toMatch(/client(?:\?)?\.requestDownloadToken(?:\?\.)?\(/);
  });

  it("omits the upload and download affordances entirely when their platform dependency is missing, rather than rendering them broken", () => {
    expect(code).toMatch(/uploadController\s*\?\s*\(/);
    expect(code).toMatch(/downloadController\s*\?\s*\(/);
    // The controllers themselves are only ever built when their platform
    // dependency is present — `filePicker`/`fetchImpl` guard their own
    // `useMemo`s, not just the render branch.
    expect(code).toMatch(/if\s*\(!client\s*\|\|\s*!filePicker\)\s*return null;/);
    expect(code).toMatch(
      /if\s*\(!client\s*\|\|\s*workspaceRoot === undefined\s*\|\|\s*!selectedEntry\s*\|\|\s*!fetchImpl\)\s*return null;/,
    );
  });

  it("wires the upload panel's actions to the controller, not local component state", () => {
    expect(code).toMatch(/onPress=\{controller\.selectFile\}/);
    expect(code).toMatch(/onPress=\{controller\.upload\}/);
  });

  it("wires the download panel's start action to controller.download with the entry's own workspace-relative path, and Cancel/Retry to controller.cancel/retry", () => {
    expect(code).toMatch(
      /onPress=\{\(\)\s*=>\s*controller\.download\(workspaceRoot,\s*entry\.path,\s*entry\.name\)\}/,
    );
    expect(code.match(/onPress=\{controller\.cancel\}/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(code.match(/onPress=\{controller\.retry\}/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("hands a completed download's bytes to the injected Sharing sink at most once, and says so explicitly when no Sharing is wired", () => {
    expect(code).toMatch(/downloadState\.status !== "success"/);
    expect(code).toMatch(/sharing\s*\.\s*shareFiles\(\[/);
    // `canSave` (whether `sharing` is actually present) reaches the
    // panel and changes its rendered message rather than being ignored.
    expect(code).toMatch(/canSave\s*\?\s*"Downloaded\."/);
  });

  it("derives canSave from the injected Sharing's own isAvailable(), never from the prop merely being present (P5-W22 merge gate)", () => {
    // T78 mounted a real `Sharing` at the route whose `shareFiles()`
    // always rejects `SHARING_FILES_UNAVAILABLE`. `canSave={Boolean(sharing)}`
    // therefore started reporting a success-toned "Downloaded." for a
    // file that reached nothing. The presence test must not come back.
    expect(code).not.toMatch(/canSave=\{Boolean\(sharing\)\}/);
    expect(code).toMatch(/canSave=\{canShareFiles\}/);
    expect(code).toMatch(
      /const \[canShareFiles, setCanShareFiles\] = useState\(false\);[\s\S]*?sharing\s*\.isAvailable\(\)\s*\.then\(\(available\) => \{\s*if \(!cancelled\) setCanShareFiles\(available\);/,
    );
  });

  it("never logs a downloaded/uploaded file's bytes, name, or path, and the download URL carries only a token", () => {
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/[?&]path=/);
    expect(code).not.toMatch(/[?&]fileName=/);
  });

  // T153 landed the fix that stops a re-read of the SAME path discarding an
  // in-progress edit buffer, but every mutation proof it shipped targets
  // `file-edit-model.ts` (the controller primitive). The behaviour the task
  // exists to fix lives HERE, in the `useMemo` that decides whether to resume
  // the previous controller's session. The P6-W15 merge gate reverted this
  // screen-side half with a one-token change (`resumeSession,` ->
  // `resumeSession: null,`) and the whole `apps/android` files suite stayed
  // green at 190 passed. A screen this component cannot render under vitest
  // (it reaches `react-native`) is exactly what this source-contract file
  // exists for.
  it("T153: resumes the in-progress edit session when the SAME path is re-read", () => {
    expect(code).toMatch(/previous\.path === file\.path/);
    // `[^}]*`, never a lazy `[\s\S]*?`: it cannot bridge past the object
    // literal's closing brace into an unrelated call. `code` is
    // comment-stripped, so this file's own prose naming `resumeSession`
    // cannot satisfy it.
    expect(code).toMatch(/createFileEditController\(\{[^}]*\bresumeSession,[^}]*\}\)/);
  });
});
