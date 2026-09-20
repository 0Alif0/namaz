# Namaz on Cloudflare — free, for life

This is the whole app deployed at no cost and with no card on file:

| Piece | Service | Free tier |
|---|---|---|
| The app itself | Cloudflare Pages | Unlimited requests, unlimited bandwidth |
| Push backend | Cloudflare Workers | 100,000 requests/day |
| Schedule storage | Cloudflare D1 | 5 GB, 5M row reads/day |
| The every-minute cron | Workers Cron Triggers | Included |

A per-minute cron costs about 1,440 of the 100,000 daily requests, so one
person's phones use roughly 2% of the free allowance.

**Why a backend exists at all:** everything you see — prayer times, Qibla, the
Hijri date, Tahajjud — is calculated on the phone. The backend does one thing:
send the push notification at the right moment. On iPhone that cannot be done
on-device, because iOS has no scheduled-notification API for web apps and stops
the service worker when the app is closed.

---

## What you need

- A free Cloudflare account — <https://dash.cloudflare.com/sign-up>. No card.
- Node.js 18+ (you already have it if `npm test` runs).
- An iPhone on **iOS 16.4 or newer**, for the notifications.

Every command below is run from this `worker/` directory unless it says otherwise.

---

## 1. Log in

```bash
npm install
npx wrangler login
```

This opens a browser once to authorise the CLI.

## 2. Create the database

```bash
npx wrangler d1 create namaz
```

It prints a `database_id`. Open `wrangler.toml` and replace
`REPLACE_WITH_YOUR_D1_DATABASE_ID` with it.

Then create the tables:

```bash
npm run schema
```

## 3. Generate the VAPID keys

VAPID is how a push service knows the notification really came from your server.

```bash
npm run vapid
```

It prints a public and a private key. Set all four secrets — paste the value
when each command prompts:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT     # mailto:you@example.com
npx wrangler secret put CRON_SECRET       # any long random string
```

`VAPID_SUBJECT` must be a real `mailto:` or `https:` URL — Apple rejects pushes
without one.

**Keep the private key.** If the pair ever changes, every phone that subscribed
has to be re-enabled.

## 4. Deploy the backend

```bash
npx wrangler deploy
```

It prints a URL like `https://namaz-api.<your-subdomain>.workers.dev`. Check it:

```bash
curl https://namaz-api.<your-subdomain>.workers.dev/api/health
# {"ok":true}
curl https://namaz-api.<your-subdomain>.workers.dev/api/vapid-public-key
# {"publicKey":"B…"}
```

If the second one returns `{"error":"not configured"}`, the secrets in step 3
did not save.

## 5. Build and deploy the app

From the **project root**, point the frontend at the Worker and build:

```bash
cd ..
echo "VITE_API_BASE_URL=https://namaz-api.<your-subdomain>.workers.dev" > .env
npm install
npm test
npm run build
```

Then publish `dist/`:

```bash
npx wrangler pages deploy dist --project-name=namaztime
```

The first run asks to create the project; accept. It prints your app URL, like
`https://namaztime.pages.dev`.

## 6. Let the app talk to the backend

The Worker only answers origins it has been told about. Put your Pages URL in
`worker/wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGINS = "https://namaztime.pages.dev"
```

Then redeploy the Worker:

```bash
cd worker && npx wrangler deploy
```

This step is easy to skip and the symptom is confusing: the app loads fine but
turning on a prayer fails with a CORS error in the console. The value must match
the scheme exactly and carry no trailing slash.

## 7. Install it on the iPhone

Open your Pages URL in **Safari** — not Chrome, only Safari can install to the
Home Screen. Share → **Add to Home Screen**. Then open it from the Home Screen
icon, not from Safari.

Turn on a prayer. iOS asks for notification permission at that moment.

**Web Push on iOS only works from the Home Screen app.** Opened in a normal
Safari tab, the switches will tell you to install it first rather than pretending
to work.

---

## Checking it actually sends

The cron runs every minute on its own. To force a round immediately:

```bash
curl -X POST -H "x-cron-secret: YOUR_CRON_SECRET" \
  https://namaz-api.<your-subdomain>.workers.dev/api/internal/dispatch
# {"due":0,"sent":0,"stale":0,"removed":0,"failed":0}
```

Watch the cron live:

```bash
npx wrangler tail
```

See what is queued:

```bash
npx wrangler d1 execute namaz --remote \
  --command="SELECT prayer, datetime(fire_at/1000,'unixepoch') AS fires_utc
             FROM scheduled_pushes WHERE sent_at IS NULL ORDER BY fire_at LIMIT 10"
```

The quickest end-to-end test that does not involve waiting for Fajr: enable a
prayer, then queue one a couple of minutes out by hand.

---

## Publishing changes later

```bash
# the app
npm run build && npx wrangler pages deploy dist --project-name=namaztime

# the backend
cd worker && npx wrangler deploy
```

Bump `CACHE_VERSION` in `public/sw.js` (`v1` → `v2`) whenever you change the
frontend, or phones will keep serving the cached old build.

## Troubleshooting

**Nothing arrives.** In order: is the app open from the Home Screen icon (not a
Safari tab); does `/api/vapid-public-key` return a key; does `npx wrangler tail`
show the cron firing each minute; does the `scheduled_pushes` query above show
unsent rows.

**A notification arrives very late.** Pushes more than 20 minutes stale are
dropped on purpose rather than sent — a Fajr reminder at 8am is worse than none.
`STALE_AFTER_MINUTES` in `src/index.js` controls that.

**CORS errors in the console.** Step 6. `ALLOWED_ORIGINS` must match the app's
origin exactly.

**The app shows an old version.** The service worker cached the previous build.
Bump `CACHE_VERSION`, redeploy, then close and reopen the app twice.

**Prayers re-enable themselves after reinstalling.** Push subscriptions are tied
to an origin. Moving to a different domain means every phone re-subscribes.

## Schedules refresh when the app is opened

The phone uploads seven days of instants each time you open it. Open the app at
least once a week or the queue runs dry and notifications stop — which is also
why the app deliberately does not ask for background permissions it cannot
honour.
