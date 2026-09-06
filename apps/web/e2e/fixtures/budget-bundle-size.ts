/**
 * T31D — CI performance-budget measurement: web session route bundle
 * size (plan.md §14.5: "web session route `/h/:serverId/session/:agentId`:
 * under 500 KiB gzip for initial JavaScript and CSS, excluding lazy
 * terminal/editor/diff chunks").
 *
 * Measures the REAL network payload a browser downloads for a fresh,
 * direct navigation to the session route against the REAL production
 * build this harness's own `preview-server.ts` already produces and
 * serves — as of T43B2b, the packaged bundle at
 * `packages/server/dist/server/web-ui` that `scripts/build-daemon-web-
 * ui.mjs` produces (every packaging path's own artifact, T43A1), whose
 * `.js`/`.css`/`.html` files are byte-identical copies of `vite build`'s
 * own `apps/web/dist` output (the same artifact `npm run build
 * --workspace=@picompanion/web` produces, plan.md §15.2) — not a static
 * guess at which chunk names "should" belong to the route.
 *
 * The budget's own "excluding lazy terminal/editor/diff chunks" falls
 * out of this approach for free: `host-session-terminal-screen.js` and
 * `host-session-files-screen.js` (the terminal and files/editor/diff
 * routes, both `lazyRouteComponent` — see `apps/web/src/routes/
 * host-session-terminal.tsx` and `host-session-files.tsx`) are only
 * ever fetched once a route actually navigates into them. A fresh
 * navigation that lands directly on the session route and never opens
 * either one never requests those chunks, so they are simply never
 * present in this capture — there is no chunk-name allowlist/denylist
 * to keep in sync as the build's chunk graph changes.
 *
 * `apps/web`'s preview server (Vite's own `preview()`, via
 * `preview-server.ts`) does not gzip-encode its responses — no
 * compression middleware is configured (`vite.config.ts`) — so the raw
 * `response.body()` bytes captured here are the uncompressed transfer.
 * This module re-compresses each one with `zlib.gzipSync` (the same
 * algorithm `vite build`'s own reported "gzip:" column uses) to get the
 * number the budget actually means: what a gzip-compressing server (the
 * daemon's own static file serving in production, or a CDN) would put
 * on the wire.
 *
 * **Why this clears the browser's HTTP cache first.** `apps/web` is a
 * single-entry SPA: every route, including `/connect`, resolves through
 * the exact same `index.html` and therefore the exact same eagerly
 * `modulepreload`-d base-shell chunks (`index.html`'s own
 * `<script type="module">` plus its `modulepreload` links — not just
 * the route's own lazily-imported screen chunk). This measurement always
 * runs after a spec's own `connectViaUi` call, which already loaded
 * `/connect` in the same browser context moments earlier and so already
 * warmed the disk/memory cache for every one of those same-URL,
 * content-hashed assets — proven empirically: without the cache clear
 * below, this measurement captured only the session route's own two
 * small chunks (~20 KiB gzip) and silently omitted the entire shared
 * base shell a real first-ever visit has no choice but to download too.
 * Clearing the cache and disabling it for this one navigation (via CDP,
 * Chromium-only — this harness's one Playwright project, per
 * `playwright.config.ts`) makes the hard navigation below a genuinely
 * cold fetch of every byte it needs, matching what the budget actually
 * describes: a first-ever/bookmarked visit to this one route.
 */
import zlib from "node:zlib";

import type { Page, Response } from "@playwright/test";

/** plan.md §14.5. */
export const SESSION_ROUTE_BUNDLE_BUDGET_BYTES = 500 * 1024;

export interface CapturedAsset {
  url: string;
  rawBytes: number;
  gzipBytes: number;
}

export interface SessionRoutePayload {
  assets: CapturedAsset[];
  totalGzipBytes: number;
}

/**
 * Only the built JS/CSS assets the budget covers — not the web fonts
 * (`.woff2`), not `index.html` itself, not the WebSocket connection to
 * the isolated daemon.
 */
function isBundledAssetUrl(url: string): boolean {
  return /\.(js|css)(\?.*)?$/.test(new URL(url).pathname);
}

/**
 * Attaches a response listener that captures every `.js`/`.css` asset
 * fetched during the navigation that follows, then performs a **fresh,
 * hard navigation** to `sessionRouteUrl` — never a client-side route
 * change from an already-open page — and waits for the composer to be
 * interactive (the same "this route is actually usable" signal
 * `session-lifecycle.spec.ts` waits on) before returning. A hard
 * navigation is deliberate: it is the only way to observe exactly what
 * a bookmarked/deep-linked visit to this one route downloads, which is
 * what the budget describes.
 *
 * `page` must already have gone through `connectViaUi` (so the stored
 * host profile lets `DaemonClientProvider` auto-reconnect after this
 * hard navigation, `connect-ui.ts`'s module doc) — that earlier
 * navigation's own requests are not captured, since the listener is
 * attached only for the navigation this function itself performs.
 */
export async function measureSessionRoutePayload(
  page: Page,
  sessionRouteUrl: string,
): Promise<SessionRoutePayload> {
  const responses = new Map<string, Response>();
  const onResponse = (response: Response): void => {
    const url = response.url();
    // A 3xx response carries no body of its own (Playwright's own
    // `response.body()` throws "Response body is unavailable for
    // redirect responses" -- proven empirically against this exact
    // preview server, which 30x-redirects at least one asset request).
    // The browser's actual follow-up request to the redirect target
    // fires its own separate `response` event under its own URL, which
    // this listener still captures -- skipping the redirect itself
    // loses no bytes, since none were ever attributable to it.
    const isRedirect = response.status() >= 300 && response.status() < 400;
    if (!isRedirect && response.request().method() === "GET" && isBundledAssetUrl(url)) {
      responses.set(url, response);
    }
  };
  page.on("response", onResponse);
  try {
    // See the module doc's "Why this clears the browser's HTTP cache
    // first" -- without this, assets the earlier `connectViaUi` call
    // already warmed in cache (the whole shared base app shell) never
    // fire a `response` event on this navigation at all.
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdpSession.send("Network.clearBrowserCache");

    await page.goto(sessionRouteUrl, { waitUntil: "networkidle" });
    await page.getByLabel("Message Pi").waitFor({ state: "visible", timeout: 15_000 });

    await cdpSession.detach().catch(() => undefined);
  } finally {
    page.off("response", onResponse);
  }

  const assets: CapturedAsset[] = [];
  for (const response of responses.values()) {
    const body = await response.body();
    const gzip = zlib.gzipSync(body, { level: 9 });
    assets.push({ url: response.url(), rawBytes: body.length, gzipBytes: gzip.length });
  }

  const totalGzipBytes = assets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
  return { assets, totalGzipBytes };
}

export function formatKiB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
