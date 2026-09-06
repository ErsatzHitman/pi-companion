/**
 * A small, self-contained Markdown subset parser for the `markdown` Pi UI
 * Bridge kind (plan.md §11.3, §16 "sanitize markdown ... do not render
 * extension-provided HTML"; T29A3).
 *
 * This module never touches the DOM and produces a plain AST — `markdown.tsx`
 * renders that AST to React elements/text, never through
 * `dangerouslySetInnerHTML`. That is the whole sanitization story: raw HTML
 * appearing inside a markdown payload (e.g. `<script>...`) is never parsed
 * as markup, only ever carried through as literal text nodes, which React
 * escapes when it commits them to the DOM. There is no HTML pass to bypass.
 *
 * This intentionally is not a full CommonMark implementation — headings,
 * paragraphs, fenced code blocks, block quotes, ordered/unordered lists,
 * horizontal rules, and the common inline spans (`**bold**`, `*em*`/`_em_`,
 * `` `code` ``, `[text](href)`) cover every extension payload in
 * `plan.md` §11.7 and the protocol fixtures.
 */

export interface MdTextNode {
  type: "text";
  value: string;
}
export interface MdStrongNode {
  type: "strong";
  children: MdInlineNode[];
}
export interface MdEmNode {
  type: "em";
  children: MdInlineNode[];
}
export interface MdCodeNode {
  type: "code";
  value: string;
}
export interface MdLinkNode {
  type: "link";
  href: string;
  children: MdInlineNode[];
}

export type MdInlineNode = MdTextNode | MdStrongNode | MdEmNode | MdCodeNode | MdLinkNode;

export interface MdHeadingBlock {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: MdInlineNode[];
}
export interface MdParagraphBlock {
  type: "paragraph";
  children: MdInlineNode[];
}
export interface MdCodeBlockBlock {
  type: "code-block";
  value: string;
  language?: string;
}
export interface MdListBlock {
  type: "list";
  ordered: boolean;
  items: MdInlineNode[][];
}
export interface MdBlockquoteBlock {
  type: "blockquote";
  children: MdBlockNode[];
}
export interface MdHrBlock {
  type: "hr";
}

export type MdBlockNode =
  | MdHeadingBlock
  | MdParagraphBlock
  | MdCodeBlockBlock
  | MdListBlock
  | MdBlockquoteBlock
  | MdHrBlock;

/** Protocols allowed in a `[text](href)` link. Anything else renders as plain text. */
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * True for a relative-looking href (no `scheme:` prefix — `#anchor`,
 * `/path`, `mailto` without a scheme-looking prefix is still caught below)
 * or one using an allow-listed scheme. `javascript:`, `data:`, `vbscript:`,
 * and anything else fall through to `false`.
 */
export function isSafeMarkdownHref(href: string): boolean {
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
  if (!schemeMatch) return true;
  return SAFE_LINK_PROTOCOLS.has(schemeMatch[1].toLowerCase() + ":");
}

const INLINE_PATTERN = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/;

/** Parses one line/paragraph of inline markdown into a flat-ish node tree. */
export function parseInline(text: string): MdInlineNode[] {
  const nodes: MdInlineNode[] = [];
  let rest = text;
  // Bounded by `rest` shrinking by at least one character every iteration
  // (every alternative in INLINE_PATTERN matches at least one character).
  while (rest.length > 0) {
    const match = INLINE_PATTERN.exec(rest);
    if (!match) {
      nodes.push({ type: "text", value: rest });
      break;
    }
    if (match.index > 0) {
      nodes.push({ type: "text", value: rest.slice(0, match.index) });
    }
    if (match[1] !== undefined) {
      nodes.push({ type: "code", value: match[1] });
    } else if (match[2] !== undefined) {
      nodes.push({ type: "strong", children: parseInline(match[2]) });
    } else if (match[3] !== undefined) {
      nodes.push({ type: "em", children: parseInline(match[3]) });
    } else if (match[4] !== undefined) {
      nodes.push({ type: "em", children: parseInline(match[4]) });
    } else if (match[5] !== undefined && match[6] !== undefined) {
      const href = match[6];
      if (isSafeMarkdownHref(href)) {
        nodes.push({ type: "link", href, children: parseInline(match[5]) });
      } else {
        // Unsafe scheme: keep the literal source text visible, but never as a
        // clickable/navigable link.
        nodes.push({ type: "text", value: match[0] });
      }
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes;
}

const FENCE_RE = /^```\s*(\S*)\s*$/;
const CLOSE_FENCE_RE = /^```\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const QUOTE_RE = /^>\s?/;
const LIST_ITEM_RE = /^\s*([-*+]|\d+\.)\s+(.*)$/;
const LIST_ITEM_IS_ORDERED_RE = /^\d+\.$/;

/** Parses a Markdown-subset document into a block-level AST. */
export function parseMarkdown(source: string): MdBlockNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const language = fenceMatch[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !CLOSE_FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence, or step past EOF if it never closed
      blocks.push({ type: "code-block", value: codeLines.join("\n"), language });
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: "heading", level, children: parseInline(headingMatch[2].trim()) });
      i++;
      continue;
    }

    if (HR_RE.test(line.trim())) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quoteLines.push(lines[i].replace(QUOTE_RE, ""));
        i++;
      }
      blocks.push({ type: "blockquote", children: parseMarkdown(quoteLines.join("\n")) });
      continue;
    }

    const listMatch = LIST_ITEM_RE.exec(line);
    if (listMatch) {
      const ordered = LIST_ITEM_IS_ORDERED_RE.test(listMatch[1]);
      const items: MdInlineNode[][] = [];
      while (i < lines.length) {
        const m = LIST_ITEM_RE.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[2]));
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !FENCE_RE.test(lines[i]) &&
      !HEADING_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i]) &&
      !LIST_ITEM_RE.test(lines[i]) &&
      !HR_RE.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", children: parseInline(paraLines.join(" ")) });
  }

  return blocks;
}
