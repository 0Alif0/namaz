# Deploying Namaz

There are two supported ways to run this, and they differ mainly in cost:

| | Cost | Notifications | Guide |
|---|---|---|---|
| **Cloudflare** | Free, no card | Yes | **[worker/README.md](worker/README.md)** |
| Hostinger | Business plan or above | Yes | This document |
| GitHub Pages | Free | No — static only | [Below](#publishing-on-github-pages) |

**If you are starting from scratch, use Cloudflare.** Pages, Workers, D1 and the
every-minute Cron Trigger are all permanently free, and it is the only free
option that can actually deliver push notifications. The rest of this document
covers the Hostinger path, which the `server/` directory targets.

---

## Deploying on Hostinger

Nothing here needs a Mac, Xcode, or a paid domain. Everything is done from hPanel
and a terminal on any operating system.

Two pieces are deployed:

| Piece | Where it goes | What it needs |
|---|---|---|
| Frontend (`dist/`) | `public_html` on your main domain | Free Hostinger SSL |
| Backend (`server/`) | A Node.js app on a subdomain | MySQL, VAPID keys, one cron job |

The frontend works on its own — prayer times, Hijri date, Tahajjud and Qibla are
all calculated on the phone. The backend exists only for push notifications and
the place-name lookup.

---

## 0. Before you start

Node.js applications are available on Hostinger's Business and Cloud plans. If
you are on a lower plan you will need to upgrade, or run the backend elsewhere;
the frontend runs on any static hosting.

Two things to check in hPanel first, because they shape the setup:

1. **Cron interval.** hPanel → Advanced → Cron Jobs. If the smallest interval is
   one minute, notifications land within a minute of the prayer time. If your plan
   only allows 5 or 15 minutes, notifications will be up to that late — see
   "If your cron is coarse" at the end.
2. **Whether the Node app sleeps when idle.** If it does, the cron job hitting it
   every minute keeps it awake anyway.

---

## 1. Build the frontend

On your own machine:

```bash
cp .env.example .env
# set VITE_API_BASE_URL to your API subdomain, e.g. https://api.yourdomain.com
npm install
npm test          # 128 tests; do not deploy if these fail
npm run build
```

This produces `dist/`.

## 2. Upload the frontend

hPanel → Files → File Manager → `public_html`.

Upload the **contents** of `dist/` (not the folder itself). You should end up with
`public_html/index.html`, `public_html/assets/…`, `public_html/sw.js`,
`public_html/manifest.webmanifest`, `public_html/icons/…`.

Then create `public_html/.htaccess` so that deep links fall back to the app and
the service worker is never cached by the CDN:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>

# The service worker must always be revalidated or users get stuck on an old build.
<FilesMatch "sw\.js$">
  Header set Cache-Control "no-cache, no-store, must-revalidate"
</FilesMatch>

# Hashed assets never change, so they can be cached hard.
<FilesMatch "\.(js|css|png|webmanifest)$">
  Header set Cache-Control "public, max-age=31536000"
</FilesMatch>
```

Note the `sw.js` rule overrides the general one because it comes first.

## 3. Turn on HTTPS

hPanel → Security → SSL. Install the free certificate and enable **Force HTTPS**.

This is not optional. Service workers, geolocation, the compass and Web Push all
refuse to run on plain HTTP.

## 4. Create the database

hPanel → Databases → Management. Create a database and a user, and note the
generated names — Hostinger prefixes them, e.g. `u123456789_namaz`.

## 5. Create the Node.js app

hPanel → Websites → your site → Node.js. Create an application:

- **Subdomain**: `api.yourdomain.com` (create it under Domains → Subdomains first)
- **Application root**: the folder you will upload `server/` into
- **Startup file**: `src/index.js`
- **Node version**: 18 or newer

Upload the `server/` directory there, or connect the GitHub repository so it
redeploys on push.

## 6. Configure environment variables

Generate the VAPID key pair on your own machine:

```bash
cd server
npm install
npm run vapid
```

Then in hPanel → Node.js → Environment Variables, add everything from
`server/.env.example`:

```
PORT=3000
ALLOWED_ORIGINS=https://yourdomain.com
DB_HOST=localhost
DB_PORT=3306
DB_USER=u123456789_namaz
DB_PASSWORD=…
DB_NAME=u123456789_namaz
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=mailto:you@yourdomain.com
CRON_SECRET=…
GEOCODE_ENDPOINT=https://api.bigdatacloud.net/data/reverse-geocode-client
```

Generate `CRON_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**The private VAPID key and the database password only ever live here.** They are
never in the frontend bundle and never in git — `.env` is in `.gitignore`.

## 7. Create the schema

From the Node app's terminal (hPanel gives you one), or from your own machine
with the database opened to your IP:

```bash
npm run migrate
```

Check it worked:

```bash
curl https://api.yourdomain.com/api/health
# {"ok":true}
curl https://api.yourdomain.com/api/vapid-public-key
# {"publicKey":"B…"}
```

## 8. Schedule the dispatcher

hPanel → Advanced → Cron Jobs. Add a job running **every minute**:

```bash
curl -fsS -m 50 -H "x-cron-secret: YOUR_CRON_SECRET" -X POST https://api.yourdomain.com/api/internal/dispatch >/dev/null 2>&1
```

That endpoint sends every push whose moment has arrived. Without this cron job,
subscriptions are stored but nothing is ever delivered.

Verify by hand once:

```bash
curl -X POST -H "x-cron-secret: YOUR_CRON_SECRET" https://api.yourdomain.com/api/internal/dispatch
# {"due":0,"sent":0,"stale":0,"removed":0,"failed":0}
```

## 9. Install on the iPhone

Open the site in **Safari** (not Chrome — only Safari can add to the Home Screen),
then Share → Add to Home Screen. Open it from the Home Screen icon.

Then turn a prayer on. iOS asks for notification permission at that moment, not
before.

**Web Push on iOS only works from the Home Screen app.** In ordinary Safari tabs
the switches will tell the user to install it first, rather than pretending to
work.

---

## Publishing on GitHub Pages

This works, with one exclusion: **push notifications will not work on GitHub
Pages.** Pages serves static files only, so there is nothing to run the Express
backend or the per-minute cron job that actually sends the pushes. Everything
else — prayer times, Hijri date, special days, Tahajjud, Qibla, the compass,
offline, Add to Home Screen — works exactly as it does on Hostinger, because all
of that is calculated on the phone.

When someone taps a notification switch on a Pages build, the app says
notifications are not available in this version and leaves the switches off. It
does not pretend to have scheduled anything.

### Setting it up

1. Push the project to a repository. `.env` is in `.gitignore` and the private
   VAPID key and database password live only in hPanel, so a public repository
   leaks nothing. Check `git status` before your first push regardless.
2. Repository → Settings → Pages → Source → **GitHub Actions**.
3. Push to `main`. The included `.github/workflows/deploy-pages.yml` runs the
   test suite, builds, and publishes. If the tests fail, nothing is published.

Your site appears at `https://<user>.github.io/<repo>/`.

### Why it works in a subfolder

Pages serves project repositories from a subpath, which normally breaks a PWA:
absolute paths like `/sw.js` and `/icons/…` resolve to the domain root, so the
service worker never registers and the icons 404. This build avoids that
entirely — Vite is configured with `base: './'`, the manifest uses a relative
`start_url` and `scope`, the worker is registered relative to the page, and
`sw.js` resolves every path against its own scope. The same build therefore runs
at a domain root and in a subfolder with no changes.

Verified locally at `/namaz/`: the worker registers with scope
`…/namaz/`, and reloading with the network switched off still produces the full
prayer times. If you prefer a root URL, name the repository
`<user>.github.io` and it will serve from `/` instead.

### The city name

Nothing to configure. The browser looks the name up itself, on Pages and on
Hostinger alike, because BigDataCloud's free endpoint only permits client-side
calls. Coordinates are rounded to two decimals (~1 km) first, but that service
does see the request arriving from the user's own IP.

To avoid that entirely, build with `VITE_DISABLE_GEOCODE=true`. The app then
contacts no geocoder and shows no city name; prayer times, Qibla and Tahajjud are
unaffected, since those come from the coordinates directly.

### Using it as a preview, then moving to Hostinger

Pages is a good way to check the layout and the prayer times on your actual
iPhone before you set up hosting. HTTPS is on by default, so geolocation, the
compass, the service worker and Add to Home Screen all work there.

When you move to Hostinger, set `VITE_API_BASE_URL` and rebuild. Push
subscriptions are bound to an origin, so anyone who installed the Pages version
will need to reinstall from the new address — worth knowing before you share the
Pages link widely.

### A custom domain later

Repository → Settings → Pages → Custom domain, then point a CNAME at
`<user>.github.io`. The relative paths mean the build does not need changing.

---

## Testing without a domain

- **Frontend only**: `npm run build`, push `dist/` to a GitHub Pages branch. Prayer
  times, Hijri date, Tahajjud and Qibla all work. Notifications will report that
  the service is unavailable, which is accurate.
- **Hostinger temporary URL**: works for everything including push, as long as the
  temporary URL has HTTPS. Set `ALLOWED_ORIGINS` to that URL.
- **Moving to a real domain later**: change `ALLOWED_ORIGINS` on the backend and
  `VITE_API_BASE_URL` in the frontend, then rebuild. Existing push subscriptions
  are tied to the origin, so users will need to reinstall from the new domain.

## Publishing a new version

1. Bump `CACHE_VERSION` in `public/sw.js` (`v1` → `v2`).
2. `npm test && npm run build`.
3. Upload `dist/` over `public_html`.

The new service worker deletes every cache that is not the current version, so
users get the new build rather than a mixture.

## If your cron is coarse

If your plan's minimum interval is 5 or 15 minutes, notifications arrive up to
that late. Two options:

- Have the single cron run call the endpoint several times with `sleep` between
  calls, e.g. `for i in 1 2 3 4 5; do curl …; sleep 60; done`.
- Accept the delay. `STALE_AFTER_MINUTES` in
  `server/src/notifications/webpush.js` controls how late is too late; a push
  older than that is dropped rather than sent, because a Fajr reminder at 8am is
  worse than none.

## Troubleshooting

**Notifications never arrive.** Check in order: is the app open from the Home
Screen icon; does `/api/vapid-public-key` return a key; is the cron job running
(its output goes to your cron log); does `SELECT COUNT(*) FROM scheduled_pushes
WHERE sent_at IS NULL` show rows.

**The app shows an old version.** The service worker cached the previous build.
Bump `CACHE_VERSION`, redeploy, then close and reopen the app twice.

**"Please allow location access."** iOS remembers a refusal. Settings → Safari →
Location, or delete and reinstall the Home Screen app.

**CORS errors in the console.** `ALLOWED_ORIGINS` does not match the origin the
app is served from. It must include the scheme and no trailing slash.
