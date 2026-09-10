import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T33B1 source-level accessibility/touch-target checks (extended by
 * T33B2 for the steer/follow-up/abort controls).
 *
 * `react-native` component modules can't be rendered under this
 * workspace's plain `vitest` setup (see the VITEST LIMITATION note this
 * task's brief carries, already proven by
 * `../../ui/primitives/touch-targets.test.ts` and
 * `../../ui/recipes/recipe-accessibility.test.ts`), so — exactly like
 * those two files — this statically verifies the source contracts a
 * render/TalkBack pass would otherwise check. The optimistic
 * pending -> sent -> failed *state* lifecycle (and the steer/follow-up
 * queue transitions, abort) is proven in `composer-model.test.ts`; this
 * file only proves the view wires that state to real accessible controls.
 * The 48dp touch-target guarantee itself is proven once, for every
 * audited interactive component including this file's
 * `composer-icon-action.tsx`, by the shared strict-AND predicate in
 * `../../ui/primitives/touch-targets.test.ts` (T85) — this file no longer
 * carries a second, looser copy of that check.
 */

function readSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
}

/**
 * `readSource` with comments stripped, for assertions that must reach
 * real code rather than being satisfiable by this file's own doc
 * comments — see `../transcript/transcript-accessibility.test.ts`'s
 * identical helper and the `header.tsx` regression it guards against.
 */
function readCode(name: string): string {
  return readSource(name)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Composer.tsx", () => {
  const source = readSource("Composer.tsx");
  /*
   * Every assertion below that must reach real JSX reads `code`, not
   * `source`. `Composer.tsx`'s own doc comment quotes
   * `accessibilityLiveRegion="polite"`, so an unanchored regex over the
   * raw file text was satisfied by that prose alone: deleting the real
   * prop from the entries `View` left this suite green, proven by
   * mutation at the P5-W5 merge gate. The raw-hex check deliberately
   * keeps reading `source` — a hex literal in a comment is worth
   * flagging too.
   */
  const code = readCode("Composer.tsx");

  it("contains no raw hex colour literal", () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("reads its styling from useTheme()", () => {
    expect(code).toMatch(/useTheme\(\)/);
  });

  it("is built on the shared PromptBar recipe, not a fork of it", () => {
    expect(code).toMatch(/from "\.\.\/\.\.\/ui\/recipes"/);
    expect(code).toMatch(/<PromptBar/);
  });

  it("gives the composer a discoverable TalkBack name via the Section primitive", () => {
    expect(code).toMatch(/<Section\s/);
    expect(code).toMatch(/COMPOSER_ACCESSIBILITY_LABEL/);
  });

  it("announces entry status changes via a polite live region", () => {
    expect(code).toMatch(/accessibilityLiveRegion="polite"/);
  });

  it("pairs every entry status with visible text, never colour alone", () => {
    expect(code).toMatch(/entryStatusLabel\(entry\.status\)/);
  });

  it("does not collapse the failed-entry Retry button into a non-interactive accessible group", () => {
    // A collapsing wrapper (a bare `accessible` prop on the row's outer
    // View, which also renders the Retry Button) would make the button
    // unreachable as its own TalkBack node. Assert the row's opening
    // `<View ...>` tag — where `ComposerEntryRow` renders its
    // `entryRow`-styled wrapper — carries no such prop.
    const rowFnStart = source.indexOf("function ComposerEntryRow");
    expect(rowFnStart).toBeGreaterThan(-1);
    const rowOpenTagStart = source.indexOf("<View", rowFnStart);
    const rowOpenTagEnd = source.indexOf(">", rowOpenTagStart);
    const rowOpenTag = source.slice(rowOpenTagStart, rowOpenTagEnd);
    expect(rowOpenTag).toMatch(/style=\{styles\.entryRow\}/);
    expect(rowOpenTag).not.toMatch(/\baccessible\b/);

    const retryBranch = source.slice(source.indexOf('entry.status === "failed"'));
    expect(retryBranch).toMatch(/<Button/);
  });

  it("renders no <Modal> element and does not import Modal from react-native (keyboard ownership: plan.md §9.3)", () => {
    expect(code).not.toMatch(/<Modal\b/);
    const reactNativeImportLine = source
      .split("\n")
      .find((line) => line.includes('from "react-native"'));
    expect(reactNativeImportLine).toBeDefined();
    expect(reactNativeImportLine).not.toMatch(/\bModal\b/);
  });

  // CORRECTED at T338: this pinned "the root container never shrinks
  // (flexShrink: 0)". Maestro run 34470287372 showed that an
  // un-shrinkable root overflows the keyboard-shrunk shell and it is the
  // PROMPT BAR that gets pushed under the IME. What must never shrink is
  // the prompt bar; everything above it scrolls.
  it("T338: root, Section and ScrollView shrink (flexShrink: 1) while PromptBar sits outside and after the ScrollView, so the prompt bar stays above the IME and the controls scroll (plan.md §9.3)", () => {
    expect(code).toMatch(/root:\s*\{\s*flexShrink:\s*1,\s*minHeight:\s*0\s*\}/);
    expect(code).toMatch(/section:\s*\{\s*flexShrink:\s*1,\s*minHeight:\s*0\s*\}/);
    expect(code).toMatch(/scroll:\s*\{\s*flexGrow:\s*0,\s*flexShrink:\s*1\s*\}/);
    // T343 adds the measured minHeight to the root's static style.
    expect(code).toMatch(/<View style=\{\[styles\.root, \{ minHeight \}\]\}/);
    expect(code).toMatch(/<Section[^>]*style=\{styles\.section\}/);
    const scrollOpen = code.indexOf("<ScrollView");
    const scrollClose = code.indexOf("</ScrollView>");
    const promptBar = code.indexOf("<PromptBar");
    expect(scrollOpen).toBeGreaterThan(-1);
    expect(scrollClose).toBeGreaterThan(scrollOpen);
    expect(promptBar).toBeGreaterThan(scrollClose);
    const scrollBody = code.slice(scrollOpen, scrollClose);
    // T329's lesson, applied here: the first tap after typing must reach
    // the control, not be spent dismissing the keyboard.
    expect(scrollBody).toMatch(/keyboardShouldPersistTaps="handled"/);
    // The pickers -- the controls that outgrow the keyboard-shrunk shell
    // -- are inside the scrolling half, never beside the prompt bar.
    expect(scrollBody).toMatch(/<QueueModePicker/);
    expect(scrollBody).toMatch(/<ModelThinkingPicker/);
    expect(scrollBody).toMatch(/<SlashCommandPicker/);
  });

  it("T343/T344: reserves the prompt bar's height — the root's minHeight is resolveComposerMinHeight over the heading's and the prompt bar's own onLayout, never a section-minus-scroll-view difference", () => {
    // Maestro run 34493338438: a shrinkable pinned area above and the
    // keyboard below squeezed the composer to its heading. Run
    // 34497459568: T343's difference of two readings paired a fresh full
    // section with a stale squeezed scroll view and froze the composer at
    // full height, so the sum below is of two views that never shrink.
    expect(code).toMatch(
      /import \{ resolveComposerMinHeight \} from "\.\/composer-min-height-model";/,
    );
    expect(code).toMatch(
      /setMinHeight\(\s*resolveComposerMinHeight\(\{\s*titleHeight: titleHeightRef\.current,\s*promptBarHeight: promptBarHeightRef\.current,\s*gap: sectionGap,\s*\}\),?\s*\)/,
    );
    expect(code).toMatch(/const sectionGap = theme\.spacing\[3\];/);
    expect(code).toMatch(/<Section[^>]*onTitleLayout=\{handleTitleLayout\}/);
    expect(code).toMatch(/<View onLayout=\{handlePromptBarLayout\}>\s*<PromptBar/);
    expect(code).not.toMatch(/sectionHeightRef|controlsHeightRef/);
    const scrollOpen = code.indexOf("<ScrollView");
    const scrollTagEnd = code.indexOf(">", scrollOpen);
    expect(code.slice(scrollOpen, scrollTagEnd)).not.toMatch(/onLayout=/);
  });

  // T75: `onSubmit` is no longer called directly from `handleSend` — it
  // moved inside `sendWithOutbox`, which every send (text-only or not)
  // now goes through. The optimistic guarantee this test proves is
  // unchanged: the entry lands in state via `setState` before the async
  // call chain that eventually awaits `onSubmit` is even invoked, so
  // this anchors to `void sendWithOutbox(...)` (the last thing
  // `handleSend` does) rather than to `onSubmit(entryText)` directly,
  // which no longer appears in this function's own text.
  it("submits optimistically: the entry is added via submitDraft, and setState runs before sendWithOutbox (and therefore onSubmit) is ever invoked", () => {
    const submitIndex = source.indexOf("submitDraft(state");
    const setStateIndex = source.indexOf("setState(nextState)");
    const sendWithOutboxCallIndex = source.indexOf(
      "void sendWithOutbox(entry.id, entry.text, attachmentsToSend)",
    );
    expect(submitIndex).toBeGreaterThan(-1);
    expect(setStateIndex).toBeGreaterThan(submitIndex);
    expect(sendWithOutboxCallIndex).toBeGreaterThan(setStateIndex);
  });
});

describe("composer-icon-action.tsx (microphone / attachment controls)", () => {
  const source = readSource("composer-icon-action.tsx");
  const code = readCode("composer-icon-action.tsx");

  it("contains no raw hex colour literal", () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("reads its styling from useTheme()", () => {
    expect(code).toMatch(/useTheme\(\)/);
  });

  // T85: this file used to carry its own 48dp check here — a whole-file
  // `minDimensions.some((value) => value >= 48)` regex scan that (a) was
  // an OR across every `minHeight`/`minWidth` in the file, not scoped to
  // this component's own touchable element, and (b) duplicated the
  // per-element, strict-AND audit `../../ui/primitives/touch-targets.test.ts`
  // already runs against this exact file (`ComposerIconAction`, added to
  // that shared loop by T81 via an explicit `path`). Two predicates for
  // one rule is how the loose one survives, so it is deleted here, not
  // relaxed: `ComposerIconAction`'s 48dp touch target is proven solely by
  // the shared audit's "ComposerIconAction declares a 48dp (or
  // hitSlop-padded) touch target" case.

  it("exposes a button role with a mandatory accessible name", () => {
    expect(code).toMatch(/accessibilityRole="button"/);
    expect(code).toMatch(/accessibilityLabel=\{accessibleName\}/);
    expect(code).toMatch(/accessibleName: string/);
  });

  it("hides its decorative glyph from assistive tech", () => {
    expect(code).toMatch(/accessibilityElementsHidden/);
  });
});

describe("Composer wires the microphone and attachment actions with distinct accessible names", () => {
  const code = readCode("Composer.tsx");

  it("uses MIC_ACTION_LABEL and ATTACH_ACTION_LABEL, not a shared/generic label", () => {
    expect(code).toMatch(/accessibleName=\{MIC_ACTION_LABEL\}/);
    expect(code).toMatch(/accessibleName=\{ATTACH_ACTION_LABEL\}/);
  });

  // T33B7: mic/attach now wire to `handleMicPress`/`handleAttachPress`,
  // not the raw `onMicPress`/`onAttachPress` props directly — those two
  // internal handlers still call the prop synchronously first (proven in
  // `attachment-wiring.test.ts`, mutation-checked), so an existing
  // caller's contract is unchanged, but each handler also now runs the
  // T33B7 permission + pick/upload flow this same file's wiring test
  // proves is real. This replaces the pre-T33B7
  // "not an inline recorder/picker" assertion, which this task's own
  // brief made obsolete: attachment picking now genuinely lives inline
  // here, behind an injected port (`attachment-wiring.test.ts`).
  it("mic and attach controls invoke the internal handlers, not the raw props directly", () => {
    expect(code).toMatch(/onPress=\{handleMicPress\}/);
    expect(code).toMatch(/onPress=\{handleAttachPress\}/);
  });
});

describe("T33B2 Composer wires Steer/Follow-up/Abort with distinct accessible names and correct handlers", () => {
  const code = readCode("Composer.tsx");

  it("each of the three controls uses its own *_ACTION_LABEL constant as its Button label (their distinctness/wording is proven in composer-model.test.ts)", () => {
    expect(code).toMatch(/label=\{STEER_ACTION_LABEL\}/);
    expect(code).toMatch(/label=\{FOLLOW_UP_ACTION_LABEL\}/);
    expect(code).toMatch(/label=\{ABORT_ACTION_LABEL\}/);
  });

  it("each control is wired to its own handler, not a shared one", () => {
    expect(code).toMatch(/onPress=\{handleSteer\}/);
    expect(code).toMatch(/onPress=\{handleFollowUp\}/);
    expect(code).toMatch(/onPress=\{handleAbort\}/);
  });

  it("the three controls are rendered only while a turn is running", () => {
    const controlsBlockStart = code.indexOf("state.turnRunning ? (");
    expect(controlsBlockStart).toBeGreaterThan(-1);
    const controlsBlockEnd = code.indexOf(") : null}", controlsBlockStart);
    expect(controlsBlockEnd).toBeGreaterThan(controlsBlockStart);
    const controlsBlock = code.slice(controlsBlockStart, controlsBlockEnd);
    expect(controlsBlock).toMatch(/label=\{STEER_ACTION_LABEL\}/);
    expect(controlsBlock).toMatch(/label=\{FOLLOW_UP_ACTION_LABEL\}/);
    expect(controlsBlock).toMatch(/label=\{ABORT_ACTION_LABEL\}/);
  });
});

describe("T33B2 Composer disables plain Send while a turn is running", () => {
  it("PromptBar's canSend requires a submittable draft AND that no turn is running AND (T33B7) no attachment still uploading", () => {
    const code = readCode("Composer.tsx");
    const promptBarStart = code.indexOf("<PromptBar");
    expect(promptBarStart).toBeGreaterThan(-1);
    const promptBarTagEnd = code.indexOf("/>", promptBarStart);
    const promptBarTag = code.slice(promptBarStart, promptBarTagEnd);
    expect(promptBarTag).toMatch(/canSend=\{[\s\S]*?canSubmitDraft\(state\.draft\)/);
    expect(promptBarTag).toMatch(/!state\.turnRunning/);
    expect(promptBarTag).toMatch(/!attachmentsHavePendingUploads\(attachmentsState\)/);
  });
});

describe("T33B2 known loose end closed: PromptBar's queued count reflects real state, not a literal", () => {
  it("queuedCount is wired to pendingCount(state), not a hardcoded 0", () => {
    const code = readCode("Composer.tsx");
    expect(code).toMatch(/queuedCount=\{pendingCount\(state\)\}/);
    expect(code).not.toMatch(/queuedCount=\{0\}/);
  });
});

describe("T33B2 steer/follow-up/abort submit optimistically, same contract as plain send", () => {
  const code = readCode("Composer.tsx");

  it("handleSteer: submitSteer runs and updates state before turnService.steer is awaited", () => {
    const submitIndex = code.indexOf("submitSteer(state");
    const setStateIndex = code.indexOf("setState(result.state)", submitIndex);
    const callIndex = code.indexOf("turnService.steer(entryText)");
    expect(submitIndex).toBeGreaterThan(-1);
    expect(setStateIndex).toBeGreaterThan(submitIndex);
    expect(callIndex).toBeGreaterThan(setStateIndex);
  });

  it("handleFollowUp: submitFollowUp runs and updates state before turnService.followUp is awaited", () => {
    const submitIndex = code.indexOf("submitFollowUp(state");
    const setStateIndex = code.indexOf("setState(result.state)", submitIndex);
    const callIndex = code.indexOf("turnService.followUp(entryText)");
    expect(submitIndex).toBeGreaterThan(-1);
    expect(setStateIndex).toBeGreaterThan(submitIndex);
    expect(callIndex).toBeGreaterThan(setStateIndex);
  });

  it("handleAbort: abortTurn runs and updates state before turnService.abort is awaited", () => {
    const abortIndex = code.indexOf("abortTurn(state)");
    const setStateIndex = code.indexOf("setState(result.state)", abortIndex);
    const callIndex = code.indexOf("turnService.abort()");
    expect(abortIndex).toBeGreaterThan(-1);
    expect(setStateIndex).toBeGreaterThan(abortIndex);
    expect(callIndex).toBeGreaterThan(setStateIndex);
  });
});

describe("T33B3 queue depth and mode are wired into the composer, not literals or colour alone", () => {
  const code = readCode("Composer.tsx");

  it("the queue status row renders only while a turn is running, alongside Steer/Follow-up/Abort", () => {
    const controlsBlockStart = code.indexOf("state.turnRunning ? (");
    expect(controlsBlockStart).toBeGreaterThan(-1);
    const controlsBlockEnd = code.indexOf(") : null}", controlsBlockStart);
    expect(controlsBlockEnd).toBeGreaterThan(controlsBlockStart);
    const controlsBlock = code.slice(controlsBlockStart, controlsBlockEnd);
    expect(controlsBlock).toMatch(/<StatusIndicator/);
    expect(controlsBlock).toMatch(/<Select/);
    expect(controlsBlock).toMatch(/label=\{STEER_ACTION_LABEL\}/);
    expect(controlsBlock).toMatch(/label=\{FOLLOW_UP_ACTION_LABEL\}/);
    expect(controlsBlock).toMatch(/label=\{ABORT_ACTION_LABEL\}/);
  });

  it("the queue depth StatusIndicator's statusText is computed from queueDepth(state), not a literal", () => {
    expect(code).toMatch(/statusText=\{queueDepthLabel\(queueDepth\(state\)\)\}/);
  });

  it("the mode Select's value is state.mode, not a hardcoded literal", () => {
    expect(code).toMatch(/<Select[\s\S]{0,300}?value=\{state\.mode\}/);
    expect(code).not.toMatch(/<Select[\s\S]{0,200}?value=\{"steer"\}/);
    expect(code).not.toMatch(/<Select[\s\S]{0,200}?value=\{"follow-up"\}/);
  });

  it("selecting a mode calls handleModeChange, which routes through setDispatchMode and turnService.setMode with a rejection revert", () => {
    expect(code).toMatch(/onValueChange=\{\(value\)\s*=>\s*handleModeChange\(/);
    const handlerStart = code.indexOf("const handleModeChange");
    expect(handlerStart).toBeGreaterThan(-1);
    const handlerEnd = code.indexOf("[state, turnService]", handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handlerBody = code.slice(handlerStart, handlerEnd);
    expect(handlerBody).toMatch(/setDispatchMode\(state, mode\)/);
    expect(handlerBody).toMatch(/turnService\.setMode\(mode\)/);
    expect(handlerBody).toMatch(/revertDispatchMode\(current, previousMode\)/);
  });
});

describe("T292: slash-command palette is wired into Composer, sits above PromptBar, and never blocks a send", () => {
  const code = readCode("Composer.tsx");

  it("mounts SlashCommandPicker strictly before <PromptBar in the render tree (an inline row, never an overlay covering it)", () => {
    const pickerIndex = code.indexOf("<SlashCommandPicker");
    const promptBarIndex = code.indexOf("<PromptBar");
    expect(pickerIndex).toBeGreaterThan(-1);
    expect(promptBarIndex).toBeGreaterThan(pickerIndex);
  });

  it("the controller is built from the injected slashCommandsClient prop, not a hard-coded command source", () => {
    expect(code).toMatch(
      /createSlashCommandsController\(\{ agentId: resolvedSessionId, client: slashCommandsClient \}\)/,
    );
  });

  it("handleValueChange notifies the slash-commands controller on every keystroke, alongside (not instead of) updating state.draft", () => {
    const handlerStart = code.indexOf("const handleValueChange = useCallback(");
    expect(handlerStart).toBeGreaterThan(-1);
    const handlerEnd = code.indexOf("[slashCommandsController],", handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handlerBody = code.slice(handlerStart, handlerEnd);
    expect(handlerBody).toMatch(
      /setState\(\(current\) => \(\{ \.\.\.current, draft: value \}\)\);/,
    );
    expect(handlerBody).toMatch(/slashCommandsController\.notifyDraftChanged\(value\);/);
  });

  it('a manual toggle (glyph "/") opens the palette via handleOpenSlashCommands, using SLASH_COMMANDS_ACTION_LABEL as its accessible name', () => {
    expect(code).toMatch(
      /<ComposerIconAction\s*\n\s*glyph=\{"\/"\}\s*\n\s*accessibleName=\{SLASH_COMMANDS_ACTION_LABEL\}\s*\n\s*onPress=\{handleOpenSlashCommands\}/,
    );
  });

  it("selecting a command (handleSelectSlashCommand) never references onSubmit or handleSend — it can only ever replace the draft and dismiss", () => {
    const handlerStart = code.indexOf("const handleSelectSlashCommand = useCallback(");
    expect(handlerStart).toBeGreaterThan(-1);
    const handlerEnd = code.indexOf("[slashCommandsController],", handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handlerBody = code.slice(handlerStart, handlerEnd);
    expect(handlerBody).toMatch(/draft: slashCommandDraftText\(command\)/);
    expect(handlerBody).toMatch(/slashCommandsController\.dismiss\(\);/);
    expect(handlerBody).not.toMatch(/onSubmit/);
    expect(handlerBody).not.toMatch(/handleSend/);
  });

  it("SlashCommandPicker's onSelect/onDismiss are wired to the real handlers, not inline no-ops", () => {
    expect(code).toMatch(/onSelect=\{handleSelectSlashCommand\}/);
    expect(code).toMatch(/onDismiss=\{handleDismissSlashCommands\}/);
  });
});

describe("T293: getEditorText / pasteToEditor composer read is wired into Composer via a live-mirrored ref", () => {
  const code = readCode("Composer.tsx");

  it("mirrors state.draft into draftRef on every change, not only inside handleValueChange", () => {
    expect(code).toMatch(
      /useEffect\(\(\) => \{\s*draftRef\.current = state\.draft;\s*\}, \[state\.draft\]\);/,
    );
  });

  it("wires wireEditorTextResponder from the injected editorTextClient prop, not a hard-coded source", () => {
    const wireStart = code.indexOf("useEffect(() => {\n    if (!editorTextClient)");
    expect(wireStart).toBeGreaterThan(-1);
    const wireEnd = code.indexOf("[editorTextClient, resolvedSessionId]);", wireStart);
    expect(wireEnd).toBeGreaterThan(wireStart);
    const wireBody = code.slice(wireStart, wireEnd);
    expect(wireBody).toMatch(/return wireEditorTextResponder\(editorTextClient, \{/);
    expect(wireBody).toMatch(/agentId: resolvedSessionId,/);
    expect(wireBody).toMatch(/getDraftText: \(\) => draftRef\.current,/);
  });

  it("does nothing when editorTextClient is undefined — no client yet, not an error", () => {
    const wireStart = code.indexOf("useEffect(() => {\n    if (!editorTextClient)");
    expect(wireStart).toBeGreaterThan(-1);
    const wireEnd = code.indexOf("[editorTextClient, resolvedSessionId]);", wireStart);
    const wireBody = code.slice(wireStart, wireEnd);
    expect(wireBody).toMatch(/if \(!editorTextClient\) \{\s*return;\s*\}/);
  });
});
