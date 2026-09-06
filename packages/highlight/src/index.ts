export type { HighlightStyle, HighlightToken } from "./types.js";
export {
  getLanguageForFile,
  getParserForFile,
  isLanguageSupported,
  getSupportedExtensions,
} from "./parsers.js";
export { createCodeMirrorHighlightStyle } from "./codemirror-highlight-style.js";
export { highlightCode, highlightLine } from "./highlighter.js";
export {
  highlightCodeLezerOnly,
  highlightLineLezerOnly,
  isLezerOnlyLanguageSupported,
} from "./lezer-highlighter.js";
export { darkHighlightColors, lightHighlightColors } from "./colors.js";
export type { SyntaxThemeId, SyntaxThemeOption, SyntaxColors } from "./themes.js";
export {
  SYNTAX_THEME_IDS,
  SYNTAX_THEME_OPTIONS,
  isSyntaxThemeId,
  resolveSyntaxColors,
} from "./themes.js";
