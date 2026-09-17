import { useCallback, useMemo, useRef } from "react";
import { StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { AgentUsage } from "@picompanion/protocol/agent-types";

import { useTheme } from "../../ui/theme/theme-context";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { buildContextPillViewModel } from "./context-pill-model";
import {
  SWIPE_ARM_PX,
  cycleOptionId,
  isSwipeReady,
  resolveSwipeStep,
  rubberBandOffsetPx,
  type SwipeStep,
} from "./footer-pill-drag-model";
import { currentModeLabel, type SessionControlsState } from "./session-controls-model";
import {
  currentModelLabel,
  currentThinkingLabel,
  selectedModelOption,
  type ModelThinkingState,
} from "./model-thinking-model";

/**
 * The four metadata pills above the prompt bar (A-COMPOSER; `spec-delta.md`
 * §2 A-COMPOSER; `plan.md`'s Android composer section). Reverses T353's
 * amendment: the artifact draws
 *
 * ```html
 * <div class="foot" data-mode="build" data-model="claude-sonnet-5" data-eff="high" data-pct="41.2">
 *   <button class="fp f-mode">   <!-- BUILD / PLAN -->
 *   <button class="fp f-model">  <!-- mono model name -->
 *   <button class="fp f-eff">    <!-- thinking effort -->
 *   <span   class="fp f-ctx"><b></b><i></i><span class="fbar"><i></i></span></span>
 * </div>
 * ```
 *
 * ABOVE `.cmp`, not a ring beside `+` — the artifact's own stated reason
 * (quoted in this task's brief): the pills sit above the bar so the
 * thing you type into is the LAST element before the screen edge and the
 * closest to the thumb. `Composer.tsx` mounts this row directly above
 * its `PromptBar`, outside the `ScrollView`, for the identical reason
 * `PromptBar` itself sits there (see that component's own T338
 * paragraph): neither may be squeezed by the keyboard-shrunk shell.
 *
 * ## Three pills are controls, one is a readout
 *
 * `f-mode`/`f-model`/`f-eff` open `PromptControlsMenu` (mode ALSO
 * toggles directly on a plain tap — see `MetadataPill`'s own doc
 * comment). `f-ctx` opens nothing: the artifact's own CSS gives it
 * `cursor:default` and no `:hover`/`:active` rule, and its click
 * dispatcher (`q('.fp.f-ctx')` is never matched anywhere in the
 * artifact's delegate) confirms it. It is drawn here as a plain `View`
 * with an `accessibilityLabel`, never a `Pressable` — see
 * `context-pill-model.ts`'s own doc comment for the numbers it draws.
 *
 * ## Drag-to-cycle and the bubble/halo/swap pop
 *
 * `f-mode`/`f-model`/`f-eff` are also `MetadataPill`s — see that
 * component's own doc comment for the full port of the artifact's
 * `fp-bubble`/`fp-halo`/`fp-swap` keyframes and its `SW_ARM`/`SW_COMMIT`/
 * `SW_MAX` drag physics (`footer-pill-drag-model.ts`). `f-ctx` gets
 * neither: the artifact's own comment for why is quoted in that file —
 * "`armPill` is only ever called on the three that are not [a readout]".
 */
export interface FooterPillsProps {
  sessionControlsState: SessionControlsState;
  onSelectMode: (modeId: string) => void;
  modelThinkingState: ModelThinkingState;
  onSelectModel: (modelId: string) => void;
  onSelectThinking: (thinkingOptionId: string | null) => void;
  /** The newest usage the daemon has reported, or `null`/absent when it has reported none. */
  usage?: AgentUsage | null;
  onOpenControlsMenu: () => void;
  /** `button.fp[data-open]` — the artifact's own accent-inverted tint while the menu a pill opens is showing. */
  controlsMenuOpen: boolean;
  testId?: string;
}

export function FooterPills({
  sessionControlsState,
  onSelectMode,
  modelThinkingState,
  onSelectModel,
  onSelectThinking,
  usage,
  onOpenControlsMenu,
  controlsMenuOpen,
  testId = "footer-pills",
}: FooterPillsProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const modeReady = sessionControlsState.availability === "ready";
  const modeIds = sessionControlsState.modes.map((mode) => mode.id);
  const modeLabel = modeReady ? currentModeLabel(sessionControlsState) : "Mode";
  const isPlanMode = modeLabel.toLowerCase().includes("plan");

  const modelReady = modelThinkingState.availability === "ready";
  const modelIds = modelThinkingState.models.map((model) => model.id);
  const modelLabel = modelReady ? currentModelLabel(modelThinkingState) : "Model";

  const effReachable = selectedModelOption(modelThinkingState)?.thinkingOptions ?? [];
  const effIds = effReachable.map((option) => option.id);
  const effLabel = modelReady ? currentThinkingLabel(modelThinkingState) : "Effort";

  const contextPill = useMemo(() => buildContextPillViewModel(usage), [usage]);
  const bandColors: Record<string, string> = {
    normal: theme.colors["ink-2"],
    warning: theme.colors.orange,
    critical: theme.colors.red,
  };
  const barColors: Record<string, string> = {
    normal: theme.colors.accent,
    warning: theme.colors.orange,
    critical: theme.colors.red,
  };

  const commitMode = useCallback(
    (step: SwipeStep): "changed" | "unchanged" => {
      const next = cycleOptionId(modeIds, sessionControlsState.currentModeId, step);
      if (next === null) return "unchanged";
      onSelectMode(next);
      return "changed";
    },
    [modeIds, onSelectMode, sessionControlsState.currentModeId],
  );
  const commitModel = useCallback(
    (step: SwipeStep): "changed" | "unchanged" => {
      const next = cycleOptionId(modelIds, modelThinkingState.modelId, step);
      if (next === null) return "unchanged";
      onSelectModel(next);
      return "changed";
    },
    [modelIds, modelThinkingState.modelId, onSelectModel],
  );
  const commitEff = useCallback(
    (step: SwipeStep): "changed" | "unchanged" => {
      const currentId =
        modelThinkingState.thinkingOptionId ?? modelThinkingState.effectiveThinkingOptionId;
      const next = cycleOptionId(effIds, currentId, step);
      if (next === null) return "unchanged";
      onSelectThinking(next);
      return "changed";
    },
    [
      effIds,
      modelThinkingState.effectiveThinkingOptionId,
      modelThinkingState.thinkingOptionId,
      onSelectThinking,
    ],
  );

  // Build/Plan is a two-state control (usually — see this file's own
  // module doc): a tap steps it directly, the same one-click-spend the
  // artifact's own comment argues for, generalised to N modes by
  // stepping rather than hardcoding a swap between exactly two ids.
  const handleModeTap = useCallback(() => {
    commitMode(1);
  }, [commitMode]);

  return (
    <View style={styles.row} testID={testId}>
      <MetadataPill
        testId={`${testId}-mode`}
        label={modeLabel.toUpperCase()}
        variant="mode"
        tinted={isPlanMode}
        openTint={false}
        disabled={!modeReady || sessionControlsState.isChangingMode || modeIds.length === 0}
        accessibilityLabel={`Mode: ${modeLabel}`}
        accessibilityHint="Double tap to switch mode"
        onPress={handleModeTap}
        onCommitStep={commitMode}
      />
      <MetadataPill
        testId={`${testId}-model`}
        label={modelLabel}
        variant="model"
        tinted={false}
        openTint={controlsMenuOpen}
        disabled={!modelReady || modelIds.length === 0}
        accessibilityLabel={`Model: ${modelLabel}`}
        accessibilityHint="Opens the model and thinking effort menu"
        onPress={onOpenControlsMenu}
        onCommitStep={commitModel}
      />
      <MetadataPill
        testId={`${testId}-eff`}
        label={effLabel}
        variant="eff"
        tinted={false}
        openTint={controlsMenuOpen}
        disabled={!modelReady || effIds.length === 0}
        accessibilityLabel={`Thinking effort: ${effLabel}`}
        accessibilityHint="Opens the model and thinking effort menu"
        onPress={onOpenControlsMenu}
        onCommitStep={commitEff}
      />
      {/* The readout pill — no Pressable, no hover, no cursor change,
          exactly as the artifact's own `.fp.f-ctx{cursor:default}`
          states. `context-pill-model.ts` owns every number below. */}
      <View
        style={styles.ctxPill}
        accessible
        accessibilityLabel={contextPill.accessibilityLabel}
        testID={`${testId}-ctx`}
      >
        <Text style={[styles.ctxPercent, { color: bandColors[contextPill.band] }]}>
          {contextPill.percentLabel}
        </Text>
        {contextPill.tokensLabel.length > 0 ? (
          <Text style={styles.ctxTokens}>{contextPill.tokensLabel}</Text>
        ) : null}
        <View style={styles.ctxBarTrack}>
          <View
            style={[
              styles.ctxBarFill,
              {
                width: `${contextPill.barFraction * 100}%`,
                backgroundColor: barColors[contextPill.band],
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

interface MetadataPillProps {
  testId: string;
  label: string;
  variant: "mode" | "model" | "eff";
  /** `.fp.f-mode.plan` — the accent tint Plan mode carries where Build carries none. */
  tinted: boolean;
  /** `button.fp[data-open]` — the accent-inverted tint while this pill's menu is open. */
  openTint: boolean;
  disabled: boolean;
  accessibilityLabel: string;
  accessibilityHint: string;
  onPress: () => void;
  /** Resolves a committed drag step against this pill's own option list; returns whether the value actually moved. */
  onCommitStep: (step: SwipeStep) => "changed" | "unchanged";
}

/**
 * One of the three interactive footer pills — `.fp.f-mode`/`.f-model`/
 * `.f-eff`. Ports three things from the artifact's CSS/JS this app has
 * no native equivalent for:
 *
 * 1. **`fp-bubble`** — a squash-and-stretch pop with decaying overshoot,
 *    quoted here as the artifact states it (`@keyframes fp-bubble`,
 *    480ms, `cubic-bezier(.22,1,.28,1)` per step):
 *    `0% scale(1,1) → 26% scale(1.17,.86) → 48% scale(.93,1.09) →
 *    66% scale(1.05,.97) → 82% scale(.985,1.015) → 100% scale(1,1)`.
 *    Ported as a `withSequence` of five `withTiming` steps on two shared
 *    values (`bubbleScaleX`/`Y`), one per keyframe segment, at the same
 *    proportional durations (`480ms × segment width`).
 * 2. **`fp-halo`** — `box-shadow: 0 0 0 0 accent46% → 0 0 0 10px
 *    transparent` over 520ms ease-out: a ring that spreads outward while
 *    fading. React Native draws no growing box-shadow, so this is an
 *    absolutely-positioned bordered overlay whose `scale` grows
 *    (1 → 1.18) while its `opacity` fades (0.46 → 0) over the same
 *    520ms — the same "spread and fade" read, without a literal
 *    box-shadow.
 * 3. **`fp-swap`** — the label's own cross-slide, `opacity:0
 *    translateX(±9px) scale(.86) → opacity:1 translateX(0) scale(1)`
 *    over 420ms. Ported directly onto the label `Text`'s wrapping
 *    `Animated.View`.
 *
 * **When these play, exactly matching the artifact.** `stepPill` is the
 * ONLY function that calls `bubble()` — a plain tap (`toggleMode`,
 * `openMenu`) never does, and neither does a menu selection
 * (`setFrom`). So the pop only ever plays from a COMMITTED or
 * ready-but-released drag, never from `onPress`. A release under
 * `SW_COMMIT` still bubbles (direction `0`, no swap — `if(Math.abs(dx)
 * <SW_COMMIT){ bubble(el,0); return; }`), and so does a release AT or
 * past it that lands back on the same value (an N=1 option list) — both
 * cases pass `onCommitStep`'s own `"unchanged"` result through as
 * direction `0`.
 *
 * **Touch handling.** This app has no `react-native-gesture-handler`
 * dependency, so the artifact's `pointerdown`/`pointermove`/`pointerup`
 * become the legacy Responder System
 * (`onStartShouldSetResponder`/`onResponderMove`/`onResponderRelease`),
 * entirely replacing `Pressable` for this control — the tap/drag split
 * has to live in ONE gesture arbiter, the same reason the artifact
 * itself funnels both through one `pointerdown` listener rather than a
 * separate `click` handler racing a drag. A release that never travelled
 * past `SWIPE_ARM_PX` is a tap and fires `onPress`; one that did is a
 * drag and is resolved through `onCommitStep` instead — never both for
 * one gesture.
 */
function MetadataPill({
  testId,
  label,
  variant,
  tinted,
  openTint,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  onCommitStep,
}: MetadataPillProps) {
  const { theme, reduceMotion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const dragX = useSharedValue(0);
  const ready = useSharedValue(0);
  const bubbleScaleX = useSharedValue(1);
  const bubbleScaleY = useSharedValue(1);
  const haloOpacity = useSharedValue(0);
  const haloScale = useSharedValue(1);
  const swapOpacity = useSharedValue(1);
  const swapX = useSharedValue(0);

  const drag = useRef({ startX: 0, dx: 0, armed: false });

  const playPop = useCallback(
    (direction: SwipeStep) => {
      if (reduceMotion) {
        dragX.value = 0;
        return;
      }
      const bezier = Easing.bezier(0.22, 1, 0.28, 1);
      // fp-bubble: five segments of a 480ms sequence, matching the
      // artifact's own keyframe percentages.
      bubbleScaleX.value = withSequence(
        withTiming(1.17, { duration: 125, easing: bezier }),
        withTiming(0.93, { duration: 106, easing: bezier }),
        withTiming(1.05, { duration: 86, easing: bezier }),
        withTiming(0.985, { duration: 77, easing: bezier }),
        withTiming(1, { duration: 86, easing: bezier }),
      );
      bubbleScaleY.value = withSequence(
        withTiming(0.86, { duration: 125, easing: bezier }),
        withTiming(1.09, { duration: 106, easing: bezier }),
        withTiming(0.97, { duration: 86, easing: bezier }),
        withTiming(1.015, { duration: 77, easing: bezier }),
        withTiming(1, { duration: 86, easing: bezier }),
      );
      dragX.value = withTiming(0, { duration: 125, easing: bezier });
      // fp-halo: a spreading, fading ring over 520ms ease-out.
      haloOpacity.value = 0.46;
      haloScale.value = 1;
      haloOpacity.value = withTiming(0, { duration: 520, easing: Easing.out(Easing.quad) });
      haloScale.value = withTiming(1.18, { duration: 520, easing: Easing.out(Easing.quad) });
      if (direction !== 0) {
        // fp-swap: the label crosses in from the edge the drag came
        // from — direction 1 (forward) reads as the artifact's own
        // dir>0 (`+9px`), direction -1 as `-9px`.
        swapOpacity.value = 0;
        swapX.value = direction > 0 ? 9 : -9;
        swapOpacity.value = withTiming(1, { duration: 420, easing: bezier });
        swapX.value = withTiming(0, { duration: 420, easing: bezier });
      }
    },
    [bubbleScaleX, bubbleScaleY, dragX, haloOpacity, haloScale, reduceMotion, swapOpacity, swapX],
  );

  const handleResponderGrant = useCallback((event: GestureResponderEvent) => {
    drag.current = { startX: event.nativeEvent.pageX, dx: 0, armed: false };
  }, []);

  const handleResponderMove = useCallback(
    (event: GestureResponderEvent) => {
      if (disabled) return;
      const dx = event.nativeEvent.pageX - drag.current.startX;
      drag.current.dx = dx;
      if (!drag.current.armed) {
        if (Math.abs(dx) < SWIPE_ARM_PX) return;
        drag.current.armed = true;
      }
      dragX.value = rubberBandOffsetPx(dx);
      ready.value = isSwipeReady(dx) ? 1 : 0;
    },
    [dragX, disabled, ready],
  );

  const handleResponderRelease = useCallback(() => {
    const { dx, armed } = drag.current;
    ready.value = 0;
    if (disabled) {
      dragX.value = 0;
      return;
    }
    if (!armed) {
      // A plain tap — SW_ARM was never crossed, so this is the
      // artifact's own click path, not stepPill.
      onPress();
      return;
    }
    const step = resolveSwipeStep(dx);
    const outcome = step === 0 ? "unchanged" : onCommitStep(step);
    playPop(outcome === "changed" ? step : 0);
  }, [dragX, disabled, onCommitStep, onPress, playPop, ready]);

  const handleResponderTerminate = useCallback(() => {
    ready.value = 0;
    dragX.value = 0;
  }, [dragX, ready]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragX.value },
      { scaleX: bubbleScaleX.value },
      { scaleY: bubbleScaleY.value },
    ],
  }));
  const readyRingStyle = useAnimatedStyle(() => ({ opacity: ready.value }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: haloOpacity.value,
    transform: [{ scale: haloScale.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: swapOpacity.value,
    transform: [{ translateX: swapX.value }, { scale: 1 }],
  }));

  const variantTextStyle =
    variant === "mode" ? styles.fpModeText : variant === "model" ? styles.fpModelText : null;

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      hitSlop={12}
      // A TalkBack double-tap activates the accessibility focus, not a
      // real touch — it never crosses `SWIPE_ARM_PX`, so without this it
      // would silently do nothing. Drag-to-cycle stays a touch-only
      // affordance (a real swipe still resolves through the Responder
      // handlers below); this is only the equivalent of a plain tap.
      onAccessibilityTap={disabled ? undefined : onPress}
      onStartShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={handleResponderGrant}
      onResponderMove={handleResponderMove}
      onResponderRelease={handleResponderRelease}
      onResponderTerminate={handleResponderTerminate}
      testID={testId}
    >
      <Animated.View
        style={[
          styles.fp,
          tinted ? styles.fpTinted : null,
          openTint ? styles.fpOpen : null,
          disabled ? styles.fpDisabled : null,
          pillStyle,
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.fpHalo, haloStyle]} />
        <Animated.View pointerEvents="none" style={[styles.fpReadyRing, readyRingStyle]} />
        <Animated.Text
          style={[
            styles.fpText,
            variantTextStyle,
            tinted ? styles.fpTintedText : null,
            openTint ? styles.fpOpenText : null,
            labelStyle,
          ]}
        >
          {label}
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

/** `.foot{padding:5px 12px 6px;gap:5px}`. */
const ROW_PADDING_TOP = 5;
const ROW_PADDING_HORIZONTAL = 12;
const ROW_PADDING_BOTTOM = 6;
const ROW_GAP = 5;
/** `.fp{height:24px;padding:0 10px;font-size:10.5px}`. */
const PILL_HEIGHT = 24;
const PILL_PADDING_HORIZONTAL = 10;
const PILL_FONT_SIZE = 10.5;
/** `.fp.f-mode{font-size:9.5px;letter-spacing:.05em}`. */
const MODE_FONT_SIZE = 9.5;
const MODE_LETTER_SPACING = 0.475; // .05em of 9.5px
/** `.fp.f-model{font-size:10px}`. */
const MODEL_FONT_SIZE = 10;
/** `.fp.f-ctx b{font-weight:600} i{font-size:9.5px}`. */
const CTX_PERCENT_SIZE = 10.5;
const CTX_TOKENS_SIZE = 9.5;
/** `.fp.f-ctx .fbar{height:3px;min-width:14px;border-radius:99px}`. */
const CTX_BAR_HEIGHT = 3;

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: ROW_GAP,
      paddingTop: ROW_PADDING_TOP,
      paddingHorizontal: ROW_PADDING_HORIZONTAL,
      paddingBottom: ROW_PADDING_BOTTOM,
      overflow: "visible",
    },
    fp: {
      position: "relative",
      flexDirection: "row",
      alignItems: "center",
      height: PILL_HEIGHT,
      paddingHorizontal: PILL_PADDING_HORIZONTAL,
      borderRadius: theme.radii.full,
      backgroundColor: theme.colors.inset,
      borderWidth: 1,
      borderColor: theme.colors.line,
    },
    fpDisabled: { opacity: 0.5 },
    fpTinted: {
      backgroundColor: theme.colors["accent-tint"],
      borderColor: "transparent",
    },
    fpOpen: {
      backgroundColor: theme.colors.accent,
      borderColor: "transparent",
    },
    fpHalo: {
      position: "absolute",
      top: -1,
      left: -1,
      right: -1,
      bottom: -1,
      borderRadius: theme.radii.full,
      borderWidth: 1.5,
      borderColor: theme.colors.accent,
    },
    fpReadyRing: {
      position: "absolute",
      top: -1.5,
      left: -1.5,
      right: -1.5,
      bottom: -1.5,
      borderRadius: theme.radii.full,
      borderWidth: 1.5,
      borderColor: theme.colors.accent,
    },
    fpText: {
      color: theme.colors["ink-2"],
      fontSize: PILL_FONT_SIZE,
      fontWeight: asFontWeight("500"),
    },
    fpTintedText: { color: theme.colors.accent },
    fpOpenText: { color: theme.colors.accentContrast },
    fpModeText: {
      fontFamily: theme.typography.variant.label.fontFamily,
      fontWeight: asFontWeight("600"),
      fontSize: MODE_FONT_SIZE,
      letterSpacing: MODE_LETTER_SPACING,
      textTransform: "uppercase",
    },
    fpModelText: {
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: MODEL_FONT_SIZE,
    },
    ctxPill: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[1],
      paddingRight: 11,
    },
    ctxPercent: {
      fontWeight: asFontWeight("600"),
      fontSize: CTX_PERCENT_SIZE,
      fontVariant: ["tabular-nums"],
    },
    ctxTokens: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: CTX_TOKENS_SIZE,
      fontVariant: ["tabular-nums"],
    },
    ctxBarTrack: {
      flex: 1,
      minWidth: 14,
      height: CTX_BAR_HEIGHT,
      borderRadius: theme.radii.full,
      backgroundColor: theme.colors["line-strong"],
      overflow: "hidden",
    },
    ctxBarFill: {
      height: CTX_BAR_HEIGHT,
      borderRadius: theme.radii.full,
    },
  });
}

export default FooterPills;
