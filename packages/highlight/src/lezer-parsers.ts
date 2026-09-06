/**
 * Raw `@lezer/*` parsers keyed by file extension, for every language
 * this package supports *except* the three (Swift, Dart, C#) whose
 * only available grammar is a CodeMirror `Language`/`StreamLanguage`
 * (see `legacy-languages.ts`). Deliberately depends only on `@lezer/*`
 * packages — never `@codemirror/language` or `@codemirror/view` — so
 * `highlighter.ts`'s always-eager `highlightCode`/`highlightLine`
 * (used by the read-only file view, T30B2) stays free of CodeMirror's
 * editor machinery for the vast majority of file types.
 * `parsers.ts`'s `getLanguageForFile` (used only by T30B3's CodeMirror
 * editor) wraps these same parser instances in `Language` objects
 * on demand.
 */
import { parser as jsParser } from "@lezer/javascript";
import { parser as jsonParser } from "@lezer/json";
import { parser as cssParser } from "@lezer/css";
import { parser as cppParser } from "@lezer/cpp";
import { parser as goParser } from "@lezer/go";
import { parser as htmlParser } from "@lezer/html";
import { parser as javaParser } from "@lezer/java";
import { parser as pythonParser } from "@lezer/python";
import { parser as markdownParser } from "@lezer/markdown";
import { parser as phpParser } from "@lezer/php";
import { parser as rustParser } from "@lezer/rust";
import { parser as xmlParser } from "@lezer/xml";
import { parser as yamlParser } from "@lezer/yaml";
import { parser as elixirParser } from "lezer-elixir";
import type { Parser } from "@lezer/common";

export const lezerParsersByExtension: Record<string, Parser> = {
  // JavaScript/TypeScript
  js: jsParser,
  jsx: jsParser.configure({ dialect: "jsx" }),
  ts: jsParser.configure({ dialect: "ts" }),
  tsx: jsParser.configure({ dialect: "ts jsx" }),
  mjs: jsParser,
  cjs: jsParser,
  // C / C++ / Objective-C
  c: cppParser,
  h: cppParser,
  cc: cppParser,
  cpp: cppParser,
  cxx: cppParser,
  hpp: cppParser,
  hxx: cppParser,
  m: cppParser,
  mm: cppParser,
  // JSON
  json: jsonParser,
  // CSS
  css: cssParser,
  scss: cssParser,
  // HTML
  html: htmlParser,
  htm: htmlParser,
  // XML
  xml: xmlParser,
  // Java
  java: javaParser,
  // Python
  py: pythonParser,
  // Go
  go: goParser,
  // PHP
  php: phpParser,
  // YAML
  yaml: yamlParser,
  yml: yamlParser,
  // Rust
  rs: rustParser,
  // Elixir
  ex: elixirParser,
  exs: elixirParser,
  // Markdown
  md: markdownParser,
  mdx: markdownParser,
};
