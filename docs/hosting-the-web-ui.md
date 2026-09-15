# Hosting the web UI on Cloudflare (free)

Goal: the web UI is always up and off your PC, on a permanent public URL,
reachable only by you.

The shape this takes, and **why it is two pieces rather than one**: the web UI
is a thin client. It is a static bundle with no server of its own, and it is
useless until a browser can open a WebSocket to your daemon. Hosting only the
bundle gives you a page that loads and can never connect — a browser on an
HTTPS page is not allowed to open a `ws://` connection to a private home IP,
and your daemon has no public address. So the UI goes on Cloudflare Pages, and
the daemon gets its own public HTTPS hostname through a Cloudflare Tunnel.

## What is already done

- **Daemon password set and verified.** Stored bcrypt-hashed at
  `daemon.auth.password` in `~/.paseo/config.json`. Proven enforced on both
  channels, not assumed: the REST API answers `401` with no token and `401`
  with a wrong one, and the WebSocket closes with code `4401`
  (`"Password required"` / `"Incorrect password"`) while the correct token
  stays open.
- **`cloudflared` installed** on the Mint box (version 2026.9.1, amd64).
- **SPA fallback committed** (`apps/web/public/_redirects`), without which
  every deep link 404s on a static host.

## Step 1 — add your domain to Cloudflare

Cloudflare's free plan is enough. You need a domain you control, pointed at
Cloudflare's nameservers. A tunnel hostname must live on a zone in your own
account; this is the one part that cannot be free-tier-substituted, because
Quick Tunnels (the no-domain option) hand out a random URL that changes on
every restart and are documented by Cloudflare as testing-and-development only.

## Step 2 — create the tunnel (on the Mint box)

```bash
ssh akshat@192.168.0.158

# Opens a browser link; authorise the zone you added in step 1.
cloudflared tunnel login

cloudflared tunnel create pi-companion
cloudflared tunnel route dns pi-companion daemon.YOURDOMAIN.com
```

Then write `~/.cloudflared/config.yml`:

```yaml
tunnel: pi-companion
credentials-file: /home/akshat/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: daemon.YOURDOMAIN.com
    service: http://127.0.0.1:6767
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

Install it as a service so it survives reboots:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

**Why the daemon's own `listen` stays `127.0.0.1:6767`:** the tunnel connects
outbound from the machine, so the daemon never needs to listen on a public
interface and no router port-forwarding is involved. Leave it bound to
loopback. That is a security property worth keeping, not an oversight.

## Step 3 — deploy the UI to Cloudflare Pages

The build must happen in the monorepo (the app depends on workspace packages),
so build locally and upload the result rather than pointing Pages at the repo:

```bash
cd /d/pi-companion/apps/web
npx vite build

npx wrangler pages project create pi-companion --production-branch main
npx wrangler pages deploy dist --project-name pi-companion
```

That prints your permanent URL, `https://pi-companion.pages.dev`.

## Step 4 — allow the new origin (required, or the browser blocks everything)

`~/.paseo/config.json` currently allows exactly one origin,
`https://app.paseo.sh`, which is Paseo's hosted app and not yours. Until your
Pages URL is added, every request from it fails CORS:

```json
"cors": { "allowedOrigins": ["https://app.paseo.sh", "https://pi-companion.pages.dev"] }
```

Then `systemctl --user restart paseo-daemon`.

## Step 5 — lock it to you alone

The password is the only thing standing between the public internet and a
daemon that runs shell commands on your PC. Put identity in front of it:

Cloudflare Zero Trust → Access → Applications → Add a self-hosted app for
`daemon.YOURDOMAIN.com`, with a policy allowing only your own email. Free for
up to 50 users. A browser session then carries the `CF_Authorization` cookie
through the WebSocket upgrade, so the app keeps working while anonymous
traffic never reaches the daemon at all.

Do the same for the Pages URL if you do not want the UI itself public.

## Connecting

Open the Pages URL → **Host address** `daemon.YOURDOMAIN.com:443`, tick **Use
TLS**, and paste the password into **Access token**.

## Honest limitations

- **Your PC still has to be on.** Pages keeps the *interface* up; the daemon is
  the product, and it runs on your machine. If the Mint box sleeps, the UI
  loads and cannot connect. This setup removes the PC as the thing serving the
  page, not as the thing doing the work.
- **A Pages deploy is a manual step** after any UI change, unless you later add
  a GitHub Action with a Cloudflare API token.
- **Access protects the browser path.** If you ever use a non-browser client
  against the tunnel hostname, it needs a service token, not the cookie.
