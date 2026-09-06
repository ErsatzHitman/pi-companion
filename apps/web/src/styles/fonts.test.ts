import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T13C (docs/issues-from-plan.md "Bundle Inter/Geist Mono and complete
 * light-theme values"): asserts the fonts are actually bundled, not just
 * named in the token layer. A token-string assertion alone ("contains
 * 'Inter'") is exactly what already passed while this gap existed — this
 * test instead parses the real `@font-face` CSS and resolves every `url(...)`
 * it declares against the filesystem, so it fails the moment a font file is
 * deleted, renamed, or the `@font-face` rule itself is removed.
 */

// Resolve relative to THIS FILE, never `process.cwd()`. Under jsdom the global
// `URL` class is jsdom's own, so `fileURLToPath(new URL(..., import.meta.url))`
// throws ERR_INVALID_URL_SCHEME — but `import.meta.url` is itself a real
// `file:` URL string, so passing the string straight to `fileURLToPath` works.
// A `process.cwd()` version of this passed under `npm test` (cwd = apps/web)
// yet failed under `vitest run --root apps/web` from the repo root, which is
// exactly the kind of invocation-dependent green that hid the original gap.
const fontsCssPath = resolve(dirname(fileURLToPath(import.meta.url)), "fonts.css");
const fontsCssDir = dirname(fontsCssPath);
const fontsCss = readFileSync(fontsCssPath, "utf8");

interface FontFaceBlock {
  family: string;
  weight: string;
  urls: string[];
}

function parseFontFaces(css: string): FontFaceBlock[] {
  const blocks: FontFaceBlock[] = [];
  const blockRe = /@font-face\s*\{([^}]*)\}/g;
  for (const match of css.matchAll(blockRe)) {
    const body = match[1] ?? "";
    const family = /font-family:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
    const weight = /font-weight:\s*([0-9]+)/.exec(body)?.[1] ?? "";
    const urls = [...body.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1] ?? "");
    blocks.push({ family, weight, urls });
  }
  return blocks;
}

describe("fonts.css (T13C — self-hosted Inter and Geist Mono)", () => {
  const faces = parseFontFaces(fontsCss);

  it("declares no CDN or remote URL — every font loads from this app's own bundle", () => {
    expect(fontsCss).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|https?:\/\//i);
  });

  it("declares font-display: swap on every @font-face rule", () => {
    const ruleBodies = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(ruleBodies.length).toBeGreaterThan(0);
    for (const body of ruleBodies) {
      expect(body).toMatch(/font-display:\s*swap/);
    }
  });

  it("declares Inter at 400/500/600/700, each pointing at a real woff2 file on disk", () => {
    const interFaces = faces.filter((f) => f.family === "Inter");
    const weights = interFaces.map((f) => f.weight).sort();
    expect(weights).toEqual(["400", "500", "600", "700"]);
    for (const face of interFaces) {
      expect(face.urls.length).toBeGreaterThan(0);
      for (const url of face.urls) {
        const absolute = resolve(fontsCssDir, url);
        expect(existsSync(absolute), `expected ${url} to exist on disk`).toBe(true);
        expect(url.endsWith(".woff2")).toBe(true);
        expect(statSync(absolute).size).toBeGreaterThan(1000);
      }
    }
  });

  it("declares Geist Mono at 400/500/600/700, each pointing at a real woff2 file on disk", () => {
    const monoFaces = faces.filter((f) => f.family === "Geist Mono");
    const weights = monoFaces.map((f) => f.weight).sort();
    expect(weights).toEqual(["400", "500", "600", "700"]);
    for (const face of monoFaces) {
      expect(face.urls.length).toBeGreaterThan(0);
      for (const url of face.urls) {
        const absolute = resolve(fontsCssDir, url);
        expect(existsSync(absolute), `expected ${url} to exist on disk`).toBe(true);
        expect(url.endsWith(".woff2")).toBe(true);
        expect(statSync(absolute).size).toBeGreaterThan(1000);
      }
    }
  });

  it("vendors the OFL license text alongside each family's assets", () => {
    expect(existsSync(resolve(fontsCssDir, "../assets/fonts/inter/OFL.txt"))).toBe(true);
    expect(existsSync(resolve(fontsCssDir, "../assets/fonts/geist-mono/OFL.txt"))).toBe(true);
  });

  it("is imported from the app's entry point, not left dead", () => {
    const mainTsx = readFileSync(resolve(fontsCssDir, "../main.tsx"), "utf8");
    expect(mainTsx).toContain('"./styles/fonts.css"');
  });
});
