/**
 * `panel` kind renderer (plan.md §11.3, §11.4; T34B4) — "Composed focused
 * view", rendered per plan.md §11.3's Android presentation column: "sheet,
 * inline card, or screen". Every decision — which section resolves to
 * which kind renderer, the nesting guard, and payload/size/registration
 * validation — lives in `panel-model.ts` and is unit tested there; this
 * file is only the native mapping, matching every other kind in this
 * directory (`diff.tsx`'s doc comment explains why this split exists at
 * all: `apps/android`'s `vitest` cannot import anything reaching
 * `react-native`).
 *
 * **T361: a sheet-placement panel is the redesign's `.pop`.** It opens
 * `Sheet`'s `floating` variant — inset from both sides, lifted clear of
 * the prompt bar, fully rounded — with a footer saying how to answer or
 * dismiss. §7.2 draws that shape for an ask-user question, and
 * `HANDOFF.md` §6.3 records that ask-user has no wire kind of its own:
 * it arrives as exactly this, a `sheet`-placed `panel` composing a
 * `form`. So the treatment is keyed on the PLACEMENT, which is the
 * thing the design is actually about, and the tag shows whichever
 * namespace sent it rather than hardcoding one string — see
 * `ask-user-model.ts` for that decision and for why the artifact's
 * keyboard footer is rewritten rather than reproduced.
 *
 * **Presentation**: `element.placement === "sheet"` opens the panel's
 * content inside the shared `Sheet` primitive (`ui/primitives/Sheet.tsx`,
 * plan.md §10.3) — which itself degrades to an inline render when no
 * `<PortalHost>` is mounted above it yet (that file's own doc comment),
 * so this renderer works whether or not the app-shell router (T32S9) has
 * landed the host. A fresh panel opens expanded; closing it is a local
 * view-only affordance (there is no wire "dismiss" action in the
 * schema — the element keeps existing in `PiUiElementStore` either way,
 * so a small reopen button stays mounted instead of the section vanishing
 * for good). `element.placement === "screen"` has no dedicated route in
 * this task's scope (`apps/android/src/app-shell/` is off limits here —
 * see this task's report for the filed seam), so it renders the same full
 * content inline, undismissable, rather than losing data behind a route
 * that does not exist yet. Every other placement (`inline`/`pinned`/
 * `status`) renders the same content directly in the shared `.blk.ext`
 * wrapper — no inner `Card`, because the wrapper is already the surface.
 * The namespace tag for every placement is drawn once by that wrapper
 * (`registry-view.tsx`), never here.
 *
 * **Fault isolation** ("a failing child does not take down the panel"):
 * each `"ok"` child mounts inside its own `ExtensionElementBoundary`
 * instance — the same per-element error boundary `registry-view.tsx`
 * already wraps every top-level element in — so one section's renderer
 * throwing replaces only that section with `ErrorState`, every sibling
 * section (each its own boundary instance) keeps rendering, and so does
 * the panel's own chrome (title, text, top-level actions).
 *
 * Action identity: a section's own actions route through
 * `${element.id}#${section.id}` (`panel-model.ts`'s
 * `resolvePanelChildDecision`), mirroring `roster.tsx`'s row-scoped
 * binding exactly.
 */
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Banner, Button, Card, Sheet } from "../../../ui/primitives";
import { asFontWeight } from "../../../ui/theme/native-style-helpers";
import { useTheme } from "../../../ui/theme/theme-context";
import {
  piUiRendererRegistry,
  type PiUiDispatchAction,
  type PiUiElementRendererProps,
} from "../registry";
import { ExtensionElementBoundary } from "../registry-boundary";
import { askUserFooterHint, askUserTagLabel } from "./ask-user-model";
import { ElementActionsRow } from "./element-actions";
import {
  buildPanelRenderModel,
  type PiUiPanelChildDecision,
  type PiUiPanelChildDiagnosticDecision,
} from "./panel-model";

type Styles = ReturnType<typeof createStyles>;

function PanelChildDiagnostic({
  decision,
  styles,
  testId,
}: {
  decision: PiUiPanelChildDiagnosticDecision;
  styles: Styles;
  testId: string;
}) {
  return (
    <View style={styles.section} testID={testId}>
      <Banner tone="warning" message={decision.diagnostic.message} testId={`${testId}-banner`} />
    </View>
  );
}

function PanelChildView({
  decision,
  revision,
  dispatchAction,
  getActionState,
  logger,
  styles,
  parentTestId,
}: {
  decision: PiUiPanelChildDecision;
  revision: number | undefined;
  dispatchAction: PiUiDispatchAction;
  getActionState: PiUiElementRendererProps<"panel">["getActionState"];
  logger: PiUiElementRendererProps<"panel">["logger"];
  styles: Styles;
  parentTestId: string;
}) {
  const testId = `${parentTestId}-section-${decision.sectionId}`;

  if (decision.status !== "ok") {
    logger.warn(`Panel section "${decision.sectionId}" did not render: ${decision.status}`, {
      sectionId: decision.sectionId,
      kind: decision.kind,
      status: decision.status,
    });
    return <PanelChildDiagnostic decision={decision} styles={styles} testId={testId} />;
  }

  const { Renderer, element, payload } = decision;
  const sectionDispatch: PiUiDispatchAction = (actionId, options) =>
    dispatchAction(actionId, { ...options, elementId: options?.elementId ?? decision.elementId });
  const sectionGetActionState: PiUiElementRendererProps<"panel">["getActionState"] = (
    actionId,
    elementIdOverride,
  ) => getActionState(actionId, elementIdOverride ?? decision.elementId);
  const sectionLogger = logger.child({ ns: element.ns, kind: element.kind, elementId: element.id });

  return (
    <View style={styles.section} testID={testId}>
      <ExtensionElementBoundary
        ns={element.ns}
        elementId={element.id}
        kind={element.kind}
        logger={sectionLogger}
        resetKey={revision}
        testId={`${testId}-error`}
      >
        <Renderer
          element={element}
          payload={payload}
          revision={revision}
          dispatchAction={sectionDispatch}
          getActionState={sectionGetActionState}
          logger={sectionLogger}
        />
      </ExtensionElementBoundary>
    </View>
  );
}

function PanelBody({
  element,
  payload,
  revision,
  dispatchAction,
  getActionState,
  logger,
  styles,
  testId,
}: PiUiElementRendererProps<"panel"> & { styles: Styles; testId: string }) {
  const model = buildPanelRenderModel(element, payload, piUiRendererRegistry);

  return (
    <View style={styles.body}>
      {model.text ? <Text style={styles.text}>{model.text}</Text> : null}
      {model.children.length > 0 ? (
        <ScrollView style={styles.scroll} testID={`${testId}-sections`}>
          {model.children.map((decision) => (
            <PanelChildView
              key={decision.sectionId}
              decision={decision}
              revision={revision}
              dispatchAction={dispatchAction}
              getActionState={getActionState}
              logger={logger}
              styles={styles}
              parentTestId={testId}
            />
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.empty}>{model.emptyText}</Text>
      )}
      <ElementActionsRow
        actions={element.actions}
        dispatchAction={dispatchAction}
        getActionState={getActionState}
        accessibilityLabel={model.actionsAccessibilityLabel}
        testIdPrefix={testId}
      />
    </View>
  );
}

export function PanelRenderer(props: PiUiElementRendererProps<"panel">) {
  const { element } = props;
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const testId = `pi-panel-${element.ns}-${element.id}`;
  const title = element.title ?? "Panel";
  // Local, view-only open state for `sheet` placement only (see module doc
  // comment on why closing never tells the daemon). Every other placement
  // ignores this and always renders inline.
  const [sheetOpen, setSheetOpen] = useState(true);

  if (element.placement === "sheet") {
    return (
      <View style={styles.sheetTrigger} testID={testId}>
        {!sheetOpen ? (
          <Card style={styles.reopenCard}>
            <Text style={styles.title}>{title}</Text>
            <Button
              label="Open"
              kind="secondary"
              onPress={() => setSheetOpen(true)}
              testId={`${testId}-reopen`}
            />
          </Card>
        ) : null}
        <Sheet
          open={sheetOpen}
          title={title}
          description={props.payload.text ?? "Panel"}
          onClose={() => setSheetOpen(false)}
          variant="floating"
          footerHint={askUserFooterHint(true)}
          testId={`${testId}-sheet`}
        >
          {/*
           * T387: the channel tag belongs INSIDE the popup — the
           * reference's `ask_user` frame carries it in the sheet's own
           * header (`.pop .h`), not under the trigger behind the scrim.
           * `registry-view.tsx` therefore draws its in-flow copy only for
           * placements that are not sheets (see its `drawsWrapperTag`), so
           * this is the one place a sheet's tag is drawn.
           */}
          <Text style={styles.nsTag} testID={`${testId}-ns-tag`}>
            {askUserTagLabel(element.ns)}
          </Text>
          <PanelBody {...props} styles={styles} testId={testId} />
        </Sheet>
      </View>
    );
  }

  return (
    <View style={styles.card} testID={testId}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <PanelBody {...props} styles={styles} testId={testId} />
    </View>
  );
}

const PANEL_SCROLL_MAX_HEIGHT = 480;

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    card: { gap: theme.spacing[3] },
    sheetTrigger: { gap: theme.spacing[2] },
    reopenCard: { gap: theme.spacing[2] },
    body: { gap: theme.spacing[3] },
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.title.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.title.fontWeight),
    },
    // The artifact's `.xl { color: var(--purple); font-weight: 700 }` in
    // the mono face — the channel tag a sheet-placement panel draws inside
    // its own popup (T387).
    nsTag: {
      color: theme.colors.purple,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
      fontWeight: asFontWeight(theme.typography.fontWeight.bold),
    },
    text: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.body.fontSize,
    },
    scroll: { maxHeight: PANEL_SCROLL_MAX_HEIGHT },
    section: { marginBottom: theme.spacing[3] },
    empty: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.body.fontSize,
    },
  });
}
