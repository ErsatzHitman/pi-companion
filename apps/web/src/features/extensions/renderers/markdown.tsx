/**
 * `markdown` kind renderer (plan.md §11.3; T29A3) — "Rich textual content",
 * presented through the web markdown renderer.
 *
 * `parseMarkdown` (`./markdown-parse.js`) turns the payload's `text` into a
 * plain AST; this module turns that AST into React elements/text only —
 * never `dangerouslySetInnerHTML` — so an extension payload can never
 * inject a `<script>` tag or any other raw HTML (plan.md §16). A string
 * like `<img onerror=...>` embedded in the source text is carried through
 * as an inert text node and rendered as literal, escaped text.
 */
import type { ElementType, ReactNode } from "react";
import { useMemo } from "react";

import { CodeBlock, Link } from "../../../ui/primitives/index.js";
import type { PiUiElementRendererProps } from "../registry.js";
import { ElementActionsRow } from "./element-actions.js";
import { parseMarkdown, type MdBlockNode, type MdInlineNode } from "./markdown-parse.js";
import "./renderers.css";

function renderInline(nodes: readonly MdInlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "text":
        return node.value;
      case "strong":
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case "code":
        return (
          <code key={key} className="pc-pi-markdown__code">
            {node.value}
          </code>
        );
      case "link":
        return (
          <Link key={key} href={node.href} external>
            {renderInline(node.children, key)}
          </Link>
        );
      default:
        return null;
    }
  });
}

function renderBlock(block: MdBlockNode, key: string): ReactNode {
  switch (block.type) {
    case "heading": {
      // Offset by one and cap at h6 so an element's own headings never
      // collide with document-level h1s owned by the shell/route.
      const Tag = `h${Math.min(6, block.level + 1)}` as ElementType;
      return (
        <Tag key={key} className="pc-pi-markdown__heading">
          {renderInline(block.children, key)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={key} className="pc-pi-markdown__paragraph">
          {renderInline(block.children, key)}
        </p>
      );
    case "code-block":
      return <CodeBlock key={key} code={block.value} language={block.language} />;
    case "list": {
      const ListTag = (block.ordered ? "ol" : "ul") as ElementType;
      return (
        <ListTag key={key} className="pc-pi-markdown__list">
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `${key}-${itemIndex}`)}</li>
          ))}
        </ListTag>
      );
    }
    case "blockquote":
      return (
        <blockquote key={key} className="pc-pi-markdown__blockquote">
          {block.children.map((child, childIndex) => renderBlock(child, `${key}-${childIndex}`))}
        </blockquote>
      );
    case "hr":
      return <hr key={key} className="pc-pi-markdown__hr" />;
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
  const title = element.title;
  const blocks = useMemo(() => parseMarkdown(payload.text), [payload.text]);

  return (
    <div className="pc-pi-markdown" data-testid={`pi-markdown-${element.ns}-${element.id}`}>
      {title ? <h3 className="pc-pi-markdown__title">{title}</h3> : null}
      <div className="pc-pi-markdown__body">
        {blocks.map((block, index) => renderBlock(block, `b-${index}`))}
      </div>
      <ElementActionsRow
        actions={element.actions}
        dispatchAction={dispatchAction}
        getActionState={getActionState}
        ariaLabel={`${title ?? "Markdown"} actions`}
      />
    </div>
  );
}
