import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

/**
 * T314. Both defects this file pins were invisible to every gate this
 * repository had, for one reason: nothing in CI resolved a module the way
 * Metro does. `expo prebuild --no-install`, `tsc` and vitest all resolve
 * through Node/TypeScript rules, and all three rewrite a `./x.js`
 * specifier onto the `x.ts` beside it. Metro does not.
 *
 * `ci.yml`'s "Android bundle smoke (Metro resolution)" step is the real
 * check — it runs Metro over the whole router graph. These tests are the
 * fast, targeted companion: they fail in milliseconds and name which of
 * the two rules broke, where the bundle step takes minutes and reports a
 * resolution error from whichever file Metro happened to reach first.
 */
const require_ = createRequire(import.meta.url);
const APP_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Metro's config type is not exported in a form worth reconstructing here.
const config = require_("./metro.config.js") as any;

const blockPatterns: RegExp[] = config.resolver.blockList.filter(
  (entry: unknown): entry is RegExp => entry instanceof RegExp,
);

const appFile = (...parts: string[]) => path.join(APP_DIR, "src", ...parts);
const rootDependencyFile = (...parts: string[]) =>
  path.join(APP_DIR, "..", "..", "node_modules", ...parts);

const isBlocked = (absolutePath: string) =>
  blockPatterns.some((pattern) => pattern.test(absolutePath));

describe("metro blockList scoping", () => {
  it("still blocks this app's own web and test sources", () => {
    // The two rules the patterns exist for (plan.md §6, §9.1 for the web
    // half; Expo Router's require.context sweeping sibling tests into the
    // bundle for the test half). Scoping them must not have weakened either.
    expect(isBlocked(appFile("features", "x", "thing.web.tsx"))).toBe(true);
    expect(isBlocked(appFile("features", "x", "thing.test.ts"))).toBe(true);
    expect(isBlocked(appFile("features", "x", "thing.spec.tsx"))).toBe(true);
  });

  it("never blocks an ordinary source file", () => {
    expect(isBlocked(appFile("features", "x", "thing.tsx"))).toBe(false);
  });

  it("does not block a dependency's own .web.* file", () => {
    // The exact file that failed the first real EAS build's bundle:
    // react-native-reanimated imports this from its own config.ts, and an
    // unscoped `\.web\.` block made a correct third-party import
    // unresolvable.
    expect(
      isBlocked(
        rootDependencyFile(
          "react-native-reanimated",
          "src",
          "layoutReanimation",
          "web",
          "animation",
          "Bounce.web.ts",
        ),
      ),
    ).toBe(false);
  });

  it("does not block a dependency's test files, or this app's own node_modules", () => {
    expect(isBlocked(rootDependencyFile("whatever", "lib", "some.test.js"))).toBe(false);
    expect(isBlocked(path.join(APP_DIR, "node_modules", "pkg", "a.web.ts"))).toBe(false);
  });
});

describe("metro resolveRequest", () => {
  // `getDefaultConfig()` leaves `resolver.resolveRequest` null, so the
  // resolver under test falls through to `context.resolveRequest` — which
  // is what makes it observable with a fake here rather than only through
  // a real bundle.
  const contextWith = (resolve: (name: string) => unknown) => ({
    resolveRequest: (_context: unknown, moduleName: string) => resolve(moduleName),
  });

  it("falls back to the extensionless specifier when a relative .js does not exist", () => {
    const attempts: string[] = [];
    const context = contextWith((moduleName) => {
      attempts.push(moduleName);
      if (moduleName.endsWith(".js")) throw new Error("not found");
      return { type: "sourceFile", filePath: "resolved.ts" };
    });

    const resolved = config.resolver.resolveRequest(
      context,
      "../features/connect/daemon-connection-store.js",
      "android",
    );

    expect(resolved).toEqual({ type: "sourceFile", filePath: "resolved.ts" });
    // The literal specifier is tried FIRST, so a real `.js` on disk wins.
    expect(attempts).toEqual([
      "../features/connect/daemon-connection-store.js",
      "../features/connect/daemon-connection-store",
    ]);
  });

  it("keeps a relative .js that really does resolve, without stripping it", () => {
    const resolve = vi.fn(() => ({ type: "sourceFile", filePath: "real.js" }));

    const resolved = config.resolver.resolveRequest(contextWith(resolve), "./plugin.js", "android");

    expect(resolved).toEqual({ type: "sourceFile", filePath: "real.js" });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("does not touch a bare package specifier that ends in .js", () => {
    // `some-pkg/thing.js` is a package path, not a relative import, and
    // stripping its extension would change which file a dependency's own
    // `exports` map resolves to.
    const attempts: string[] = [];
    const context = contextWith((moduleName) => {
      attempts.push(moduleName);
      throw new Error("not found");
    });

    expect(() => config.resolver.resolveRequest(context, "some-pkg/thing.js", "android")).toThrow(
      "not found",
    );
    expect(attempts).toEqual(["some-pkg/thing.js"]);
  });

  it("still pins every react-native request to this app's own copy", () => {
    // The pre-existing rule this file must not have disturbed.
    const seen: { origin: unknown; name: string }[] = [];
    const context = {
      originModulePath: "somewhere/else",
      resolveRequest: (innerContext: { originModulePath?: string }, moduleName: string) => {
        seen.push({ origin: innerContext.originModulePath, name: moduleName });
        return { type: "sourceFile", filePath: "rn" };
      },
    };

    config.resolver.resolveRequest(context, "react-native/Libraries/Alert/Alert.js", "android");

    expect(seen).toHaveLength(1);
    expect(seen[0].origin).toBe(path.join(APP_DIR, "node_modules", "react-native", "package.json"));
  });
});
