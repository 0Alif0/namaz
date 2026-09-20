# Salah

A single-screen prayer times app for iPhone. Today's times, the Hijri date, the
last third of the night, the Qibla, and prayer notifications. No settings page,
no tabs, no audio.

```
npm install
npm test        # 128 tests
npm run dev
```

To put it online free, including notifications, follow
[worker/README.md](worker/README.md) — Cloudflare Pages for the app, Workers +
D1 + an every-minute cron for the push backend, all on permanently free tiers.
[DEPLOYMENT.md](DEPLOYMENT.md) covers the alternatives: Hostinger (paid) and
GitHub Pages (free, but no notifications).

## How it is put together

Everything the user sees is calculated on their own phone. The backend exists for
two things only: sending push notifications at the right moment, and turning a
rounded coordinate pair into a city name.

```
iPhone (Home Screen PWA)
  React + TypeScript + Vite
  adhan 4.4.4 ................. prayer times, bundled locally
  Intl (islamic-umalqura) ..... Hijri date
  localStorage ................ coordinates, switch states
  service worker .............. offline shell, receives pushes
        |
        |  POST /api/schedule   { subscription, timezone, prefs, schedule[] }
        v                        <- UTC instants only, never coordinates
Push backend — either one, same contract:
  worker/  Cloudflare Workers + D1, Cron Trigger every minute   (free)
  server/  Express + MySQL, cron every minute                   (Hostinger)
        |
        v
  Web Push -> APNs -> iPhone
```

Both backends share `server/src/services/validate.js`, so the input rules are
tested once and hold for either.

## Prayer calculation

`adhan` v4.4.4 (MIT, Batoul Apps), pinned and bundled — no CDN. Its astronomy
comes straight from Jean Meeus, *Astronomical Algorithms*. We do not implement
solar geometry ourselves.

The method is ISNA (`CalculationMethod.NorthAmerica()`): Fajr 15°, Isha 15°,
standard Asr, no minute adjustments. Those values are asserted in
`tests/prayer.test.ts`, so an upgrade that quietly changes them fails the build.

Above 48° latitude a high-latitude rule is applied automatically. During polar day
or polar night the engine throws instead of returning a time, and the screen says
so. It never invents a value.

### Verification, New York, 8 September 2026 (40.64, −73.98)

| | Calculated | Reference | Difference |
|---|---|---|---|
| Fajr | 5:12 AM | 5:13 AM | −1 min |
| Sunrise | 6:30 AM | 6:28 AM | +2 min |
| Dhuhr | 12:55 PM | 12:54 PM | +1 min |
| Asr | 4:29 PM | 4:30 PM | −1 min |
| Maghrib | 7:16 PM | 7:17 PM | −1 min |
| Isha | 8:34 PM | 8:34 PM | 0 |

No offsets were added to close the two-minute sunrise gap. The most likely
explanation is that the reference source applies an elevation or refraction
adjustment to sunrise and sunset. If you find out what the reference actually is,
that gap can be addressed properly rather than fudged.

## Definitions worth knowing

**The last third of the night** is measured **Maghrib → next day's Fajr**, which
is what the specification's written rule says:

```
last third start = Maghrib + (Fajr − Maghrib) × 2/3
last third end   = Fajr − 1 minute
```

The window closes a minute before Fajr rather than at it: Fajr ending the night
is what defines the third, not a moment you are still free to be praying in.

The worked example in the same specification says 2:46 AM, which comes from
measuring the night **sunset → sunrise** instead. Both are in real use. Both are
pinned in `tests/tahajjud.test.ts`. To switch, pass `sunrise` instead of
`nextFajr` in `App.tsx` and `notifications/schedule.ts`.

**Which night is shown** depends on the time of day, and this matters. Before
Fajr the night in progress began at *yesterday's* Maghrib, so that is the window
displayed — at 2 AM in New York on 8 September 2026 it reads 1:54 AM – 5:12 AM.
Pairing today's Maghrib with tomorrow's Fajr instead would read 1:54 AM – 5:14 AM:
almost identical on the clock, but a different night ending twenty-seven hours
away. `activeLastThird()` picks between them, and if the applicable night cannot
be calculated the panel says so rather than substituting the other one.

**Tahajjud** itself is the voluntary night prayer, not the interval. The interval
is the last third; Tahajjud may be prayed through the night, and the last third
is its most emphasised portion. It therefore sits in the list directly after
Isha, labelled `Tahajjud · last third`, and the notification and its switch name
the interval rather than the prayer.

**The Hijri date** uses the Umm al-Qura calendar. It is calculated, not observed,
and ICU's other Islamic calendars disagree with it: for 8 September 2026 in New
York, umalqura and tbla give 26 Rabi al-Awwal, civil gives 25, and the
observational approximation gives 27. Tapping the date shifts it by ±1 day and
remembers the choice, for people whose local announcement differs.

**Special days** roll over at Maghrib, not midnight, so "night of" observances
appear on the correct evening. Moon-dependent occasions are labelled as expected
rather than certain.

**Location follows you.** Position is re-checked whenever the app comes to the
foreground, and on a slow timer while it is left open. Those passes refuse a
cached fix — the browser will otherwise hand back a position up to its
`maximumAge` old and travel goes unnoticed. A background pass is silent: no
spinner, and a failure leaves the last known location in place rather than
replacing the screen with an error. Move more than 20 km and the queued
notifications are rebuilt for the new position, so landing in London does not
leave you on Brooklyn's Fajr.

## Privacy

Coordinates never leave the device except rounded to two decimals (~1 km) for the
place-name lookup, which the browser makes directly. BigDataCloud's free endpoint
requires client-side calls and bans servers that proxy it, so the geocoder does
see the user's IP. Build with `VITE_DISABLE_GEOCODE=true` to skip the lookup
entirely. The push backend stores an endpoint, its keys, a timezone and a list of UTC
instants. There is no column anywhere for a coordinate, a place name, or a user
identifier. No analytics, no advertising, no third-party scripts.

## Layout

```
src/
  components/     Header, PrayerTimesPanel, QiblaPanel,
                  NotificationsPanel, Toggle, Notice
  prayer/         engine.ts, sanity.ts, tahajjud.ts, next.ts
  qibla/          bearing.ts, compass.ts
  calendar/       hijri.ts, specialDays.ts
  location/       geolocation.ts, reverseGeocode.ts, distance.ts
  notifications/  push.ts, schedule.ts
  storage/        prefs.ts
  utils/          time.ts, format.ts
server/src/
  routes/         schedule.js, vapid.js, placeName.js, dispatch.js
  notifications/  webpush.js
  database/       pool.js, migrate.js, migrations.sql
  services/       validate.js   <- shared with worker/
worker/
  src/index.js    routes + the cron's scheduled() handler
  schema.sql      the same tables, in SQLite
tests/            prayer, qibla, tahajjud, calendar, next, placeName,
                  notifications, serverValidation
```

No calculation code imports React. No component imports `adhan`.

## Tests

```bash
npm test
```

Covers ISNA parameters, the New York case with printed deltas, Asr plausibility
including the 10:17 PM failure case, ordering across 365 days in eight cities,
both 2026 DST transitions, a zone without DST, past and future dates, polar day
and polar night, Qibla for five cities cross-checked against adhan's own
implementation, Tahajjud under both definitions, Hijri progression over 1200 days,
special-day matching, which prayer window is open (including the gap between
sunrise and Dhuhr, where none is), which night's last third applies and that it
closes before Fajr, the rollover to tomorrow's Fajr after Isha, place-name
formatting from real geocoder responses, the full notification sequence with
persistence, schedule building, and server-side input validation.

`npm test` does not cover: real Web Push delivery, iOS Home Screen installation,
or the physical compass. Those need a real iPhone. See the status report.
