import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

describe("fonts.css (T13C — self-hosted Inter and JetBrains Mono, UI-X7)", () => {
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

  it("declares JetBrains Mono at 400/500/600/700, each pointing at a real woff2 file on disk", () => {
    const monoFaces = faces.filter((f) => f.family === "JetBrains Mono");
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
    expect(existsSync(resolve(fontsCssDir, "../assets/fonts/jetbrains-mono/OFL.txt"))).toBe(true);
  });

  it("is imported from the app's entry point, not left dead", () => {
    const mainTsx = readFileSync(resolve(fontsCssDir, "../main.tsx"), "utf8");
    expect(mainTsx).toContain('"./styles/fonts.css"');
  });
});

/**
 * PROSE-1 — the guard `apps/android/src/ui/theme/fonts.test.ts` already has
 * (T367), ported to `apps/web`, which never got one.
 *
 * UI-X7 unified both apps on JetBrains Mono for pixel parity with
 * `docs/ui-reference/pi-companion-web.html`, but several comments across
 * `apps/web/src` still explained a mono `font-family` by naming "Geist
 * Mono" — the face this app dropped. PROSE-1 reworded the live ones; this
 * is the check that keeps the sweep swept, the same way the Android guard
 * does for that app's tree, so the next stale mention fails a test instead
 * of surviving until the next manual grep.
 *
 * Unlike the Android guard, this one also walks `.css` files: every live
 * hit PROSE-1 found here was a CSS rule's own doc comment
 * (`context-meter.css`, `session-cost-meter.css`, `renderers.css`,
 * `tool-call-row.css`), not a `.ts`/`.tsx` one, so a `.ts`/`.tsx`-only walk
 * would have missed the exact population this guard exists to catch.
 */
describe("apps/web mono-face sweep stays swept (PROSE-1)", () => {
  it("no live comment explains a web style by naming the face UI-X7 dropped", () => {
    const srcRoot = resolve(fontsCssDir, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|css)$/.test(entry.name)) files.push(full);
      }
    };
    walk(srcRoot);
    // The walk has to actually reach the tree, or this case passes by
    // finding nothing — the "check that cannot fail" shape CLAUDE.md names
    // in three separate sections.
    expect(files.length).toBeGreaterThan(100);

    // Resolve THIS file the same way `fontsCssPath` above does, and for the
    // same reason its comment gives: under jsdom the global `URL` class is
    // jsdom's own, so `new URL(..., import.meta.url)` throws
    // ERR_INVALID_URL_SCHEME, while passing the `file:` string straight to
    // `fileURLToPath` works.
    const thisFile = join(dirname(fileURLToPath(import.meta.url)), "fonts.test.ts");
    // The same `HISTORICAL_QUOTE_MARKERS` idea `scripts/ci/guard-capability-
    // prose.mjs` uses, plus `swapped`/`used to`/`wrong on`, mirroring the
    // Android guard's own exemption list, so a future correction that
    // quotes "Geist Mono" verbatim to explain what was wrong does not trip
    // this guard against its own narration. `docs/issues-from-plan.md`'s
    // own task-title quotations ("Bundle Inter/Geist Mono …") also match —
    // they are dated ledger provenance, not a live claim about this app.
    const HISTORY =
      /(used to|this said|previously said|no longer|swapped|CORRECTED|wrong on|issues-from-plan\.md)/i;
    const live: string[] = [];
    for (const file of files) {
      if (file === thisFile) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/Geist[\s*/]*Mono/g)) {
        // The whole surrounding window, not one physical line: these
        // comments wrap, so a marker can sit on a different line than the
        // quoted name.
        const window = text.slice(
          Math.max(0, (match.index ?? 0) - 400),
          (match.index ?? 0) + match[0].length + 200,
        );
        if (!HISTORY.test(window)) live.push(`${file}: ${window.slice(300, 500)}`);
      }
    }
    expect(
      live,
      `a comment still names Geist Mono as this app's face:\n${live.join("\n")}`,
    ).toEqual([]);
  });
});
