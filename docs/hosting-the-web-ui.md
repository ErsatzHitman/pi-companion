# Hosting the web UI (live setup)

**Live URL: https://ersatzhitman.github.io/**

The UI is served by GitHub Pages and talks to the daemon on the Mint box through
an ngrok tunnel. Verified end to end: loading that URL, signing in, and reading
the real session list off the daemon.

## Why it is two pieces

The web UI is a thin client — a static bundle with no server of its own, useless
until a browser can open a WebSocket to the daemon. Hosting only the bundle
gives a page that loads and can never connect: a browser on an HTTPS page may
not open `ws://` to a private home IP, and the daemon has no public address of
its own. So the bundle goes on Pages, and the daemon gets a public HTTPS
hostname from ngrok.

## The pieces

| Piece | Where | Notes |
| --- | --- | --- |
| Web UI | GitHub Pages, repo `ErsatzHitman/ErsatzHitman.github.io` | Free, always up, root path so no `base` change |
| Daemon | Mint box, `127.0.0.1:6767` | Never listens publicly |
| Tunnel | ngrok → `likewise-swore-crabgrass.ngrok-free.dev` | `ngrok-paseo` user service, restarts on boot |
| Auth | bcrypt password at `daemon.auth.password` | Enforced on REST *and* WebSocket |

## Connecting

Host address `likewise-swore-crabgrass.ngrok-free.dev:443`, tick **Use TLS**,
paste the password into **Access token**, press **Connect**.

**"Signed in to …" is success, and the app does not navigate on its own.** This
reads like a failure and is not one: `ConnectForm`'s `handleSubmit` saves a host
profile and reports the outcome; it never routes anywhere. The header badge
still says "Disconnected" at that point because the app only opens a connection
once you are on a host route. Pick the host from the session rail, or go to
`/h/<profileId>/sessions`.

## Things that were fixed to make this work, and will bite again if changed

- **Host allowlist.** The daemon has vite-style DNS-rebinding protection and
  answered `403 {"error":"Invalid Host header"}` to every tunnelled request
  until the ngrok hostname was added to `daemon.hostnames`. Defaults
  (localhost, private IPs) are always allowed, so adding an entry is additive
  and does not break LAN access — confirmed after the change.
- **CORS.** `daemon.cors.allowedOrigins` shipped containing only
  `https://app.paseo.sh`, which is Paseo's app, not this one. The Pages origin
  had to be added or the browser blocks everything.
- **SPA deep links.** GitHub Pages has no rewrite rules, so `404.html` is a copy
  of `index.html`. Without it, `/h/<id>/sessions` returns Pages' own 404 on a
  reload or a shared link. `.nojekyll` stops Jekyll dropping underscore files.
  `apps/web/public/_redirects` does the same job on Cloudflare Pages/Netlify.

## ngrok free limits, measured rather than assumed

- **1 GB/month transfer** — the real ceiling. Streaming terminal output is what
  would consume it.
- **20k HTTP requests/month** — barely relevant here: the app is WebSocket
  based, so it costs one upgrade request per connection and everything after
  flows inside that socket.
- **Interstitial warning page.** ngrok injects it on browser HTML navigation —
  confirmed by request against this very tunnel. It does **not** affect the
  WebSocket upgrade or `fetch`, which is exactly why the UI is on Pages and only
  the daemon is behind ngrok. Serving the UI through the tunnel would put that
  click-through in front of every page load.

## Honest limitations

- **The PC still has to be awake.** Pages keeps the interface up; the daemon is
  the product and it runs on your machine. This removes the PC as the thing
  serving the page, not as the thing doing the work.
- **A UI change needs a redeploy** — rebuild `apps/web` and push the output to
  the Pages repo.
- **The password is the only gate.** Anyone with the URL and the password
  reaches a daemon that runs shell commands. Cloudflare Access (free, needs a
  domain) would add an identity layer in front; ngrok's equivalent is a paid
  feature.
- **Rotate the credentials if this conversation is shared** — both the daemon
  password and the ngrok authtoken were typed in plain text during setup.

## Redeploying the UI

```bash
cd /d/pi-companion/apps/web && npx vite build
cd <pages-clone> && cp -r /d/pi-companion/apps/web/dist/. . \
  && cp index.html 404.html && touch .nojekyll \
  && git add -A && git commit -m "rebuild" && git push
```
