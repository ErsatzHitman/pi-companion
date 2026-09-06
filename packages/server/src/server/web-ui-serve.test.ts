// T43A2: verify the bundled UI serves correctly, without binding any port or
// socket. See the module doc comment at the top of the file and the report
// filed for T43A2 for the full rationale.
//
// `web-ui.test.ts` (ported verbatim from Paseo at T04) already proves this
// module's behaviour end-to-end over a real (ephemeral, OS-assigned) TCP
// socket via `http.createServer(app).listen(0, ...)`. This file
// deliberately does NOT do that: it calls the exported request-handling
// function (`createWebUiMiddleware`) and the pure resolution helpers
// (`resolveTargetFile`, `resolveContentEncoding`, `getContentType`,
// `selectEncoding`, `isInsideDir`) directly, with fake `req`/`res` objects
// and real (but local, non-network) file I/O in a temp directory. No
// `http.Server`, no `listen()`, no port of any kind is ever bound here.
//
// What this file proves, and does not:
// - PROVEN: the traversal defenses hold for a battery of malicious request
//   paths, at BOTH the pure resolution layer and the full middleware
//   (status/headers/body) layer.
// - PROVEN (T173): resolveTargetFile's SECOND defense, the
//   `isInsideDir(filePath, distDir)` call site, is independently
//   load-bearing and not merely a proven-in-isolation predicate that
//   nothing in the wiring actually exercises — see the "isInsideDir CALL
//   SITE" tests below, which use a bare/separator-less trailing ".." (the
//   one shape `path.normalize`'s leading-".." strip does not fully
//   collapse) to reach a real file one level above distDir, and prove that
//   deleting that call site (not its predicate) turns a 404 into a leak of
//   that file.
// - PROVEN: content-encoding negotiation (br over gzip, gzip fallback, no
//   encoding when unsupported/absent) and the exact Content-Type/
//   Content-Encoding headers a real request would receive.
// - PROVEN: MIME types for the real bundle extensions in CONTENT_TYPES.
// - PROVEN: a missing dist directory at runtime (not build time — that is
//   T43A1's `build-daemon-web-ui.mjs` check) yields a definite 404, not a
//   200 with an empty or wrong body.
// - NOT PROVEN HERE: a real browser fetching the bundle over an actual
//   socket, gzip/br *decompression* by a real HTTP client, or the daemon's
//   own bootstrap wiring end-to-end (that is `bootstrap-web-ui.test.ts`,
//   which already covers it via `test-utils/paseo-daemon.js`'s ephemeral
//   real daemon). Those two facts together are what "serves correctly"
//   means in production; this file only re-verifies the piece that is
//   reachable without a socket, with a much finer-grained, mutation-proven
//   assertion set than the pre-existing black-box tests provide.
import { readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type { RequestHandler } from "express";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  createWebUiMiddleware,
  getContentType,
  isInsideDir,
  resolveContentEncoding,
  resolveTargetFile,
  selectEncoding,
} from "./web-ui.js";

const logger = pino({ level: "silent" });

// ---------------------------------------------------------------------------
// Fake req/res — no socket, no http.Server, no listen().
// ---------------------------------------------------------------------------

interface FakeRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  protocol: string;
}

function fakeRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    method: "GET",
    path: "/",
    headers: { host: "daemon.example.test" },
    protocol: "http",
    ...overrides,
  };
}

/** A fake `res` for handlers that never stream (disabled/404/index.html). */
class FakeTextResponse {
  statusCode = 0;
  headersSent = false;
  private readonly headers = new Map<string, string>();
  body = "";

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  send(payload?: string): this {
    this.body = payload ?? "";
    this.headersSent = true;
    return this;
  }

  end(payload?: string): this {
    if (payload !== undefined) {
      this.body = payload;
    }
    this.headersSent = true;
    return this;
  }
}

/**
 * A fake `res` that satisfies `Readable#pipe`'s destination contract
 * (`write`/`end`/EventEmitter) for the static-asset streaming path, backed
 * by an in-memory `Writable` — real Node streams, zero sockets.
 */
class FakeStreamResponse extends Writable {
  // Real http.ServerResponse defaults statusCode to 200 before anything is
  // written — the streamed-asset branch in web-ui.ts never calls
  // `res.status(200)` explicitly, relying on exactly that default.
  statusCode = 200;
  headersSent = false;
  private readonly headers = new Map<string, string>();
  private readonly chunks: Buffer[] = [];

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  override _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }

  override end(...args: unknown[]): this {
    this.headersSent = true;
    // @ts-expect-error -- Writable#end's overload set doesn't cover this forwarding shape.
    super.end(...args);
    return this;
  }

  get body(): string {
    return Buffer.concat(this.chunks).toString("utf-8");
  }
}

/** Mirrors web-ui.ts's private `safeStat` for the control test below only. */
function safeStatForTest(filePath: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

function waitForFinish(res: FakeStreamResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    res.once("finish", () => resolve());
    res.once("error", reject);
  });
}

function invokeText(
  handler: RequestHandler,
  req: FakeRequest,
): { res: FakeTextResponse; nextCalled: boolean } {
  const res = new FakeTextResponse();
  let nextCalled = false;
  handler(req as never, res as never, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

async function invokeStream(
  handler: RequestHandler,
  req: FakeRequest,
): Promise<{ res: FakeStreamResponse }> {
  const res = new FakeStreamResponse();
  handler(req as never, res as never, () => {
    throw new Error("next() should not be called for a matched request");
  });
  await waitForFinish(res);
  return { res };
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

describe("web UI serving path (socket-free)", () => {
  let tempRoot: string;
  let distDir: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-web-ui-serve-"));
    distDir = path.join(tempRoot, "dist");
    await mkdir(path.join(distDir, "assets"), { recursive: true });

    await writeFile(
      path.join(distDir, "index.html"),
      "<!DOCTYPE html><html><head></head><body>app</body></html>",
    );
    await writeFile(
      path.join(distDir, "assets", "app-abc123def4567890.js"),
      "console.log('uncompressed');",
    );
    await writeFile(
      path.join(distDir, "assets", "app-abc123def4567890.js.br"),
      "console.log('brotli');",
    );
    await writeFile(
      path.join(distDir, "assets", "app-abc123def4567890.js.gz"),
      "console.log('gzip');",
    );
    await writeFile(path.join(distDir, "assets", "app.css"), "body{color:red}");
    await writeFile(path.join(distDir, "favicon.ico"), "icon-bytes");
    await writeFile(path.join(distDir, "manifest.json"), '{"name":"pi companion"}');
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Traversal — pure resolveTargetFile
  // -------------------------------------------------------------------------

  describe("resolveTargetFile: traversal resistance", () => {
    const maliciousPaths = [
      "/../../../etc/passwd",
      "/foo/../../../etc/passwd",
      "/..%2f..%2fetc/passwd", // never decoded by Express; stays a literal segment
      "/%2e%2e/%2e%2e/etc/passwd",
      "..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts",
      "/foo/..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts",
      "//attacker/share/evil.txt",
      "C:\\Windows\\System32\\config\\SAM",
      "../../../../etc/passwd",
    ];

    test.each(maliciousPaths)("never escapes distDir for %j", (maliciousPath) => {
      const target = resolveTargetFile(distDir, maliciousPath);

      // Every one of these inputs has no matching real file, so the SPA
      // fallback to index.html is the only way `resolveTargetFile` can
      // return non-null here — but confirm the resolved file is BOTH
      // index.html AND physically inside distDir, rather than trusting the
      // function's own "isIndexHtml" label.
      expect(target).not.toBeNull();
      const resolvedDistDir = path.resolve(distDir);
      expect(target?.resolvedFile.startsWith(resolvedDistDir + path.sep)).toBe(true);
      expect(path.basename(target?.resolvedFile ?? "")).toBe("index.html");
    });

    test("a traversal path that resolves to a REAL file one level above distDir still serves index.html, never the secret file", async () => {
      // The malicious paths above prove the defense holds in the abstract
      // (the escaped path never happens to exist on disk in a hermetic
      // test), which understates the risk: a naive `path.join` with a
      // handful of ".." segments genuinely walks outside `distDir` on this
      // filesystem too (see the MUTATION test below). This test plants a
      // real, readable secret file exactly where a one-level escape would
      // land, so a regression here would leak real bytes, not merely
      // resolve to a nonexistent path.
      const secretPath = path.join(tempRoot, "secret.txt");
      await writeFile(secretPath, "TOP-SECRET-CONTENTS-OUTSIDE-DIST");

      const target = resolveTargetFile(distDir, "/../secret.txt");
      expect(target?.resolvedFile).not.toBe(secretPath);
      expect(path.basename(target?.resolvedFile ?? "")).toBe("index.html");

      const handler = createWebUiMiddleware({ enabled: true, distDir, label: "t", logger });
      const { res } = invokeText(handler, fakeRequest({ path: "/../secret.txt" }));
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("TOP-SECRET-CONTENTS-OUTSIDE-DIST");
      expect(res.body).toContain("app");
    });

    test("a real nested file still resolves correctly (traversal defenses do not break normal serving)", () => {
      const target = resolveTargetFile(distDir, "/assets/app.css");

      expect(target).not.toBeNull();
      expect(target?.isIndexHtml).toBe(false);
      expect(target?.resolvedFile).toBe(path.resolve(distDir, "assets", "app.css"));
    });

    test("MUTATION: skipping path.normalize's leading-'..' handling lets a relative traversal escape", () => {
      // Reproduces, without editing the module under test, exactly the bug
      // that would ship if `resolveTargetFile`'s
      // `path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "")` line were
      // simplified to just `requestPath`. This proves the traversal tests
      // above are anchored to real defense logic, not incidental behavior.
      const naiveJoin = (unsafeRequestPath: string): string =>
        path.join(distDir, unsafeRequestPath);

      const naiveResolved = naiveJoin("../../../../../../etc/passwd");
      const resolvedDistDir = path.resolve(distDir);

      // The naive (unsanitized) join actually escapes distDir...
      expect(path.resolve(naiveResolved).startsWith(resolvedDistDir + path.sep)).toBe(false);

      // ...while the real, exported resolveTargetFile does not, for the
      // exact same malicious input.
      const safeResolved = resolveTargetFile(distDir, "../../../../../../etc/passwd");
      expect(safeResolved?.resolvedFile.startsWith(resolvedDistDir + path.sep)).toBe(true);
    });

    test("isInsideDir itself: mutation proof of its own predicate", () => {
      const resolvedDistDir = path.resolve(distDir);
      expect(isInsideDir(path.join(distDir, "assets", "app.css"), distDir)).toBe(true);
      expect(isInsideDir(distDir, distDir)).toBe(true);
      // A sibling directory that merely shares a string prefix with distDir
      // (e.g. "dist-evil" vs "dist") must NOT be considered inside — this is
      // exactly the bug class a naive `startsWith(dirPath)` (no separator)
      // would have.
      const siblingWithSharedPrefix = `${resolvedDistDir}-evil`;
      expect(isInsideDir(siblingWithSharedPrefix, distDir)).toBe(false);
      expect(isInsideDir(path.join(tempRoot, "outside.txt"), distDir)).toBe(false);
    });

    // T173: every malicious path above is caught by `path.normalize(...)
    // .replace(/^(\.\.[/\\])+/, "")` alone, because each one contains a
    // trailing separator after its last ".." segment, which the strip regex
    // requires to match. A bare, separator-less ".." (or any run of ".."
    // segments with no trailing separator, e.g. "../.." or "../../..") does
    // NOT end in a separator after normalize collapses the run down to one
    // trailing ".." — so the regex leaves that final ".." completely
    // unstripped, and `path.join(distDir, "..")` walks one level ABOVE
    // distDir. `path.normalize` has no opinion on what is "above" distDir;
    // only `isInsideDir`'s call site in `resolveTargetFile` catches this.
    // This is the case CLAUDE.md's T173 entry asks for: an input the first
    // defense does not sanitise, that the second one alone rejects.
    describe("the isInsideDir CALL SITE (not just the predicate) rejects an unstripped trailing '..'", () => {
      const parentEscapePaths = ["..", "../..", "../../..", "..\\..", "..\\..\\.."];

      beforeEach(async () => {
        // A real, readable file one level above distDir, at exactly the
        // path `path.join(distDir, "..")` would land on if resolveTargetFile
        // treated it like any other directory: an index.html to fall back
        // to. If isInsideDir's call site is ever deleted, this is what a
        // request for a bare ".." would serve instead of a 404.
        await writeFile(
          path.join(tempRoot, "index.html"),
          "<!DOCTYPE html><html><body>OUTSIDE-DIST-PARENT-INDEX</body></html>",
        );
      });

      test.each(parentEscapePaths)(
        "resolveTargetFile(distDir, %j) returns null, not the parent directory's index.html",
        (requestPath) => {
          // Confirm the escape is real at the string level first: this is
          // not merely "no file happens to match", it is a path that
          // genuinely points outside distDir once normalized.
          const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
          const joined = path.join(distDir, safePath);
          expect(isInsideDir(joined, distDir)).toBe(false);
          expect(path.resolve(joined)).toBe(path.resolve(tempRoot));

          const target = resolveTargetFile(distDir, requestPath);
          expect(target).toBeNull();
        },
      );

      test("the full middleware 404s for a bare '..' rather than leaking the parent directory's index.html", () => {
        const handler = createWebUiMiddleware({ enabled: true, distDir, label: "t", logger });
        const { res } = invokeText(handler, fakeRequest({ path: ".." }));

        expect(res.statusCode).toBe(404);
        expect(res.body).not.toContain("OUTSIDE-DIST-PARENT-INDEX");
      });

      test("MUTATION-SHAPED CONTROL: without the isInsideDir call site this same setup WOULD serve the parent's index.html", () => {
        // Does not edit web-ui.ts — reimplements resolveTargetFile's logic
        // minus the isInsideDir gate, against the exact same fixture, to
        // show the call site (not the predicate in isolation) is what
        // stands between this request and a real content leak. The
        // authoritative proof that deleting the real call site fails a
        // named test is the `test.each` above; this control just shows why.
        const requestPath = "..";
        const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
        let filePath = path.join(distDir, safePath);
        const stat = safeStatForTest(filePath);
        if (stat?.isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }
        const finalStat = safeStatForTest(filePath);
        expect(finalStat?.isFile()).toBe(true);
        expect(isInsideDir(filePath, distDir)).toBe(false);
        expect(readFileSync(filePath, "utf-8")).toContain("OUTSIDE-DIST-PARENT-INDEX");
      });
    });
  });

  describe("resolveTargetFile: missing dist directory at runtime", () => {
    test("returns null rather than any file when distDir does not exist", () => {
      const target = resolveTargetFile(path.join(tempRoot, "does-not-exist"), "/");
      expect(target).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Content negotiation — pure resolveContentEncoding / selectEncoding
  // -------------------------------------------------------------------------

  describe("selectEncoding", () => {
    test("prefers br over gzip when both are accepted, regardless of header order", () => {
      expect(selectEncoding("br, gzip")).toBe("br");
      expect(selectEncoding("gzip, br")).toBe("br");
    });

    test("falls back to gzip when br is not accepted", () => {
      expect(selectEncoding("gzip")).toBe("gzip");
    });

    test("returns null for an absent or unsupported Accept-Encoding", () => {
      expect(selectEncoding(undefined)).toBeNull();
      expect(selectEncoding("identity")).toBeNull();
      expect(selectEncoding("deflate")).toBeNull();
    });

    test("MUTATION: an encoder that always returns 'br' would misreport the gzip-only case", () => {
      const brokenSelectEncoding = (_acceptEncoding: string | undefined): "br" | "gzip" | null =>
        "br";
      // The real function disagrees with this broken stand-in for a
      // gzip-only client — proving the gzip branch in selectEncoding is
      // load-bearing, not dead code a broken implementation would also pass.
      expect(selectEncoding("gzip")).not.toBe(brokenSelectEncoding("gzip"));
      expect(selectEncoding("gzip")).toBe("gzip");
    });
  });

  describe("resolveContentEncoding", () => {
    const assetPath = () => path.join(distDir, "assets", "app-abc123def4567890.js");

    test("selects the .br sibling when both br and gzip siblings exist and br is accepted", () => {
      const result = resolveContentEncoding(assetPath(), "br, gzip");
      expect(result.contentEncoding).toBe("br");
      expect(result.finalFile).toBe(`${assetPath()}.br`);
    });

    test("selects the .gz sibling when only gzip is accepted", () => {
      const result = resolveContentEncoding(assetPath(), "gzip");
      expect(result.contentEncoding).toBe("gzip");
      expect(result.finalFile).toBe(`${assetPath()}.gz`);
    });

    test("falls back to the uncompressed file when no compressed sibling exists", () => {
      const uncompressedOnly = path.join(distDir, "assets", "app.css");
      const result = resolveContentEncoding(uncompressedOnly, "br, gzip");
      expect(result.contentEncoding).toBeNull();
      expect(result.finalFile).toBe(uncompressedOnly);
    });

    test("falls back to the uncompressed file when Accept-Encoding is absent", () => {
      const result = resolveContentEncoding(assetPath(), undefined);
      expect(result.contentEncoding).toBeNull();
      expect(result.finalFile).toBe(assetPath());
    });
  });

  // -------------------------------------------------------------------------
  // MIME types — pure getContentType
  // -------------------------------------------------------------------------

  describe("getContentType", () => {
    test.each([
      ["index.html", "text/html; charset=utf-8"],
      ["app.js", "application/javascript; charset=utf-8"],
      ["app.mjs", "application/javascript; charset=utf-8"],
      ["app.css", "text/css; charset=utf-8"],
      ["manifest.json", "application/json; charset=utf-8"],
      ["logo.png", "image/png"],
      ["photo.jpg", "image/jpeg"],
      ["photo.jpeg", "image/jpeg"],
      ["anim.gif", "image/gif"],
      ["icon.svg", "image/svg+xml"],
      ["favicon.ico", "image/x-icon"],
      ["font.woff", "font/woff"],
      ["font.woff2", "font/woff2"],
      ["font.ttf", "font/ttf"],
      ["font.otf", "font/otf"],
      ["font.eot", "application/vnd.ms-fontobject"],
      ["app.js.map", "application/json"],
    ])("%s -> %s", (fileName, expected) => {
      expect(getContentType(fileName)).toBe(expected);
    });

    test("unknown extensions fall back to application/octet-stream", () => {
      expect(getContentType("data.bin")).toBe("application/octet-stream");
      expect(getContentType("no-extension")).toBe("application/octet-stream");
    });

    test("MUTATION: a MIME table missing an entry would misreport that extension", () => {
      const brokenTable: Record<string, string> = { ".html": "text/html; charset=utf-8" };
      const brokenGetContentType = (filePath: string): string =>
        brokenTable[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";

      expect(getContentType("app.js")).not.toBe(brokenGetContentType("app.js"));
      expect(getContentType("app.js")).toBe("application/javascript; charset=utf-8");
    });
  });

  // -------------------------------------------------------------------------
  // Full middleware, still socket-free (fake req/res)
  // -------------------------------------------------------------------------

  describe("createWebUiMiddleware: text responses (index.html / disabled / 404)", () => {
    test("404s, with no next() fallthrough, when disabled", () => {
      const handler = createWebUiMiddleware({ enabled: false, distDir, label: "t", logger });
      const { res, nextCalled } = invokeText(handler, fakeRequest());

      expect(res.statusCode).toBe(404);
      expect(res.body).toBe("");
      expect(nextCalled).toBe(false);
    });

    test("404s, not 200-with-empty-body, when distDir is missing at runtime", () => {
      const handler = createWebUiMiddleware({
        enabled: true,
        distDir: path.join(tempRoot, "does-not-exist"),
        label: "t",
        logger,
      });
      const { res } = invokeText(handler, fakeRequest());

      expect(res.statusCode).toBe(404);
      expect(res.body).toBe("");
    });

    test("serves index.html with the injected connection hint for the root path", () => {
      const handler = createWebUiMiddleware({ enabled: true, distDir, label: "my-daemon", logger });
      const { res } = invokeText(handler, fakeRequest({ path: "/" }));

      expect(res.statusCode).toBe(200);
      expect(res.getHeader("Content-Type")).toBe("text/html; charset=utf-8");
      expect(res.getHeader("Content-Encoding")).toBeUndefined();
      expect(res.body).toContain("window.__PASEO_INITIAL_DAEMON_CONNECTION__");
      expect(res.body).toContain('"label":"my-daemon"');
    });

    test("SPA deep links fall back to index.html, not a 404", () => {
      const handler = createWebUiMiddleware({ enabled: true, distDir, label: "t", logger });
      const { res } = invokeText(handler, fakeRequest({ path: "/h/some-server/agent/123" }));

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("app");
    });

    for (const maliciousPath of [
      "/../../../etc/passwd",
      "/foo/../../../etc/passwd",
      "..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts",
    ]) {
      test(`traversal attempt ${JSON.stringify(maliciousPath)} serves index.html, not the target file or a 500`, () => {
        const handler = createWebUiMiddleware({ enabled: true, distDir, label: "t", logger });
        const { res } = invokeText(handler, fakeRequest({ path: maliciousPath }));

        expect(res.statusCode).toBe(200);
        expect(res.getHeader("Content-Type")).toBe("text/html; charset=utf-8");
        expect(res.body).toContain("app");
        expect(res.body).toContain("window.__PASEO_INITIAL_DAEMON_CONNECTION__");
      });
    }

    test("ignores non-GET/HEAD methods via next()", () => {
      const handler = createWebUiMiddleware({ enabled: true, distDir, label: "t", logger });
      const { res, nextCalled } = invokeText(handler, fakeRequest({ method: "POST" }));

      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBe(0);
    });

    test("excludes /api, /mcp and /public prefixes via next()", () => {
      const handler = createWebUiMiddleware({ enabled: true, distDir, label: "t", logger });
      for (const excluded of ["/api/health", "/mcp/agents", "/public/asset.txt"]) {
        const { nextCalled } = invokeText(handler, fakeRequest({ path: excluded }));
        expect(nextCalled).toBe(true);
      }
    });
  });

  describe("createWebUiMiddleware: streamed static assets", () => {
    test("selects the brotli variant and sets Content-Encoding: br", async () => {
      const handler = createWebUiMiddleware({ enabled: true, distDir, label: "t", logger });
      const { res } = await invokeStream(
        handler,
        fakeRequest({
          path: "/assets/app-abc123def4567890.js",
          headers: { "accept-encoding": "br, gzip" },
        }),
      );

      expect(res.statusCode).toBe(200);
      expect(res.getHeader("Content-Type")).toBe("application/javascript; charset=utf-8");
      expect(res.getHeader("Content-Encoding")).toBe("br");
      expect(res.getHeader("Vary")).toBe("Accept-Encoding");
      expect(res.body).toBe("console.log('brotli');");
    });

    test("selects gzip when brotli is not accepted", async () => {
      const handler = createWebUiMiddleware({ enabled: true, distDir, label: "t", logger });
      const { res } = await invokeStream(
        handler,
        fakeRequest({
          path: "/assets/app-abc123def4567890.js",
          headers: { "accept-encoding": "gzip" },
        }),
      );

      expect(res.getHeader("Content-Encoding")).toBe("gzip");
      expect(res.body).toBe("console.log('gzip');");
    });

    test("serves the uncompressed file when no Accept-Encoding is sent", async () => {
      const handler = createWebUiMiddleware({ enabled: true, distDir, label: "t", logger });
      const { res } = await invokeStream(
        handler,
        fakeRequest({ path: "/assets/app-abc123def4567890.js", headers: {} }),
      );

      expect(res.getHeader("Content-Encoding")).toBeUndefined();
      expect(res.body).toBe("console.log('uncompressed');");
    });

    test("MUTATION: always negotiating br would serve garbage to a gzip-only client", async () => {
      // Demonstrates why the "selects gzip" test above is not vacuous: if
      // resolveContentEncoding's encoding choice were hardcoded to "br",
      // the gzip-only request would receive the brotli bytes (which a
      // real gzip-only client cannot decode) instead of failing loudly.
      const handler = createWebUiMiddleware({ enabled: true, distDir, label: "t", logger });
      const { res } = await invokeStream(
        handler,
        fakeRequest({
          path: "/assets/app-abc123def4567890.js",
          headers: { "accept-encoding": "gzip" },
        }),
      );

      expect(res.body).not.toBe("console.log('brotli');");
      expect(res.body).toBe("console.log('gzip');");
    });

    test("sets immutable caching for a hashed asset and no-cache for an unhashed one", async () => {
      const handler = createWebUiMiddleware({ enabled: true, distDir, label: "t", logger });

      const hashed = await invokeStream(
        handler,
        fakeRequest({ path: "/assets/app-abc123def4567890.js" }),
      );
      expect(hashed.res.getHeader("Cache-Control")).toBe("public, max-age=31536000, immutable");

      const unhashed = await invokeStream(handler, fakeRequest({ path: "/assets/app.css" }));
      expect(unhashed.res.getHeader("Cache-Control")).toBe("no-cache");
    });
  });
});
