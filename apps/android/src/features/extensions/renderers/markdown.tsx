/**
 * `markdown` kind renderer (plan.md §11.3, §16; T34A3) — "Rich textual
 * content", presented through a native markdown renderer.
 *
 * `markdown-model.ts` turns the payload's `text` into a plain AST; this
 * module turns that AST into `Text`/`View` elements only — there is no
 * `WebView` anywhere in this component, so an extension payload can never
 * inject raw HTML (plan.md §16). A string like `<img onerror=...>`
 * embedded in the source text is carried through as an inert `text` node
 * and rendered as literal characters inside a `Text` component, the same
 * way `apps/web/src/features/extensions/renderers/markdown.tsx` renders it
 * as an escaped text node rather than through `dangerouslySetInnerHTML`.
 *
 * React Native has no `<ul>`/`<ol>`/`<blockquote>`/`<hr>`, so lists get an
 * explicit bullet/number prefix, block quotes get a left rule plus muted
 * ink, and a horizontal rule maps onto the `Divider` primitive. A link's
 * label is flattened to plain text (`Link`'s `label` prop is a flat
 * string, unlike the web `Link`'s `children`) and opens through
 * `Linking.openURL`, already gated by `markdown-model.ts`'s
 * `isSafeMarkdownHref` so only `http:`/`https:`/`mailto:` and relative
 * hrefs ever reach it.
 */
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { asFontWeight } from "../../../ui/theme/native-style-helpers";
import { useTheme } from "../../../ui/theme/theme-context";
import { CodeBlock, Divider, Link } from "../../../ui/primitives";
import type { PiUiElementRendererProps } from "../registry";
import { ElementActionsRow } from "./element-actions";
import {
  buildMarkdownRenderModel,
  flattenInlineText,
  type MdBlockNode,
  type MdInlineNode,
} from "./markdown-model";
import { piUiToneGlyph, readPiUiElementTone, toneChipLabel } from "./tone";

type Styles = ReturnType<typeof createStyles>;

function InlineNodes({
  nodes,
  styles,
  onOpenLink,
}: {
  nodes: readonly MdInlineNode[];
  styles: Styles;
  onOpenLink: (href: string) => void;
}): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "strong":
        return (
          <Text key={index} style={styles.strong}>
            <InlineNodes nodes={node.children} styles={styles} onOpenLink={onOpenLink} />
          </Text>
        );
      case "em":
        return (
          <Text key={index} style={styles.em}>
            <InlineNodes nodes={node.children} styles={styles} onOpenLink={onOpenLink} />
          </Text>
        );
      case "code":
        return (
          <Text key={index} style={styles.inlineCode}>
            {node.value}
          </Text>
        );
      case "link":
        return (
          <Link
            key={index}
            label={flattenInlineText(node.children)}
            onPress={() => onOpenLink(node.href)}
            external
          />
        );
      default:
        return null;
    }
  });
}

function Block({
  block,
  index,
  styles,
  onOpenLink,
}: {
  block: MdBlockNode;
  index: number;
  styles: Styles;
  onOpenLink: (href: string) => void;
}): ReactNode {
  switch (block.type) {
    case "heading": {
      // Two size steps only (RN has no h1-h6 typography scale here): the
      // top two levels read as a heading, everything deeper as a bold label.
      const style = block.level <= 2 ? styles.heading : styles.subheading;
      return (
        <Text key={index} style={style} accessibilityRole="header">
          <InlineNodes nodes={block.children} styles={styles} onOpenLink={onOpenLink} />
        </Text>
      );
    }
    case "paragraph":
      return (
        <Text key={index} style={styles.paragraph}>
          <InlineNodes nodes={block.children} styles={styles} onOpenLink={onOpenLink} />
        </Text>
      );
    case "code-block":
      return <CodeBlock key={index} code={block.value} language={block.language} />;
    case "list":
      return (
        <View key={index} style={styles.list}>
          {block.items.map((item, itemIndex) => (
            <Text key={itemIndex} style={styles.listItem}>
              {block.ordered ? `${itemIndex + 1}. ` : "• "}
              <InlineNodes nodes={item} styles={styles} onOpenLink={onOpenLink} />
            </Text>
          ))}
        </View>
      );
    case "blockquote":
      return (
        <View key={index} style={styles.blockquote}>
          {block.children.map((child, childIndex) => (
            <Block
              key={childIndex}
              block={child}
              index={childIndex}
              styles={styles}
              onOpenLink={onOpenLink}
            />
          ))}
        </View>
      );
    case "hr":
      return <Divider key={index} />;
    default:
      return null;
  }
}

export function MarkdownRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"markdown">) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = buildMarkdownRenderModel(element, payload);
  const testId = `pi-markdown-${element.ns}-${element.id}`;
  // A tone-carrying markdown block leads with the artifact's severity
  // glyph, painted in the tone's colour, and spells the tone out beside
  // it so the meaning is never glyph-only (plan.md §10.5).
  const tone = readPiUiElementTone(element);
  const toneGlyph = piUiToneGlyph(tone);
  const onOpenLink = useCallback((href: string) => {
    void Linking.openURL(href).catch(() => undefined);
  }, []);

  return (
    <View style={styles.wrapper} testID={testId}>
      {model.title ? (
        <Text style={styles.title} accessibilityRole="header">
          {model.title}
        </Text>
      ) : null}
      <View style={styles.body}>
        {tone && toneGlyph ? (
          <Text style={styles.toneLine} testID={`${testId}-tone`}>
            <Text style={{ color: theme.colors.status[toneGlyph.statusKey].foreground }}>
              {`${toneGlyph.glyph} `}
            </Text>
            {toneChipLabel(tone)}
          </Text>
        ) : null}
        {model.blocks.map((block, index) => (
          <Block key={index} block={block} index={index} styles={styles} onOpenLink={onOpenLink} />
        ))}
      </View>
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

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: { gap: theme.spacing[2] },
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    body: { gap: theme.spacing[2] },
    toneLine: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    heading: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.heading.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.heading.fontWeight),
    },
    subheading: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    paragraph: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      lineHeight: theme.typography.variant.body.lineHeight,
    },
    strong: { fontWeight: asFontWeight(theme.typography.fontWeight.bold) },
    em: { fontStyle: "italic" },
    inlineCode: {
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
      color: theme.colors.code.codeForeground,
      backgroundColor: theme.colors.code.codeBackground,
    },
    list: { gap: theme.spacing[1] },
    listItem: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
    blockquote: {
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.line,
      paddingLeft: theme.spacing[3],
      gap: theme.spacing[2],
    },
  });
}
