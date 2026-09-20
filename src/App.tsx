import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header';
import Notice from './components/Notice';
import NotificationsPanel from './components/NotificationsPanel';
import PrayerTimesPanel from './components/PrayerTimesPanel';
import QiblaPanel from './components/QiblaPanel';
import { currentHijriDate } from './calendar/hijri';
import { findSpecialDay } from './calendar/specialDays';
import { getCurrentPosition, LocationError } from './location/geolocation';
import { distanceKm } from './location/distance';
import { cachedPlaceName, reverseGeocode } from './location/reverseGeocode';
import { buildSchedule } from './notifications/schedule';
import { resyncSchedule } from './notifications/push';
import {
  calculatePrayerTimesForCivilDate,
  PrayerCalculationError,
  type PrayerTimesResult,
} from './prayer/engine';
import { findNextPrayer, windowProgress } from './prayer/next';
import { checkPrayerTimes } from './prayer/sanity';
import { activeLastThird, calculateLastThird, type LastThirdResult } from './prayer/tahajjud';
import { calculateQiblaBearing, qiblaIsMeaningful } from './qibla/bearing';
import {
  anyEnabled,
  loadHijriOffset,
  loadLocation,
  loadNotificationPrefs,
  saveHijriOffset,
  saveLocation,
  saveNotificationPrefs,
  type NotificationPrefs,
  type StoredLocation,
} from './storage/prefs';
import { addDays, civilDate, deviceTimeZone } from './utils/time';
import type { HijriDayOffset } from './calendar/hijri';

/** How often to re-check position while the app is open. */
const LOCATION_REFRESH_MS = 30 * 60_000;

/**
 * How far you must move before the queued notifications are rebuilt. Prayer
 * times shift about a minute per 25 km of longitude, so anything under this is
 * noise rather than travel.
 */
const RESYNC_DISTANCE_KM = 20;

type PrayerState =
  | { status: 'pending' }
  | {
      status: 'ready';
      times: PrayerTimesResult;
      /** Yesterday's Maghrib to today's Fajr — the night still running before Fajr. */
      lastThirdInProgress: LastThirdResult | null;
      /** Today's Maghrib to tomorrow's Fajr — the night about to begin. */
      lastThirdUpcoming: LastThirdResult | null;
      tomorrowFajr: Date | null;
    }
  | { status: 'failed'; message: string };

function describeLocationError(error: unknown): string {
  if (error instanceof LocationError) {
    switch (error.reason) {
      case 'denied':
        return 'Please allow location access to calculate prayer times.';
      case 'timeout':
        return 'Getting your location took too long. Try again.';
      case 'unsupported':
        return 'This device cannot provide a location, so prayer times cannot be calculated.';
      default:
        return 'Your location could not be determined. Try again.';
    }
  }
  return 'Your location could not be determined. Try again.';
}

export default function App() {
  const [now, setNow] = useState(() => new Date());
  const [location, setLocation] = useState<StoredLocation | null>(() => loadLocation());
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => loadNotificationPrefs());
  const [hijriOffset, setHijriOffset] = useState<HijriDayOffset>(() => loadHijriOffset());

  // Read inside effects that must not re-run when the switches change.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * A background refresh keeps its mouth shut: no spinner on the button, and a
   * failure leaves the last known location in place rather than replacing the
   * screen with an error. Only a refresh the user asked for reports anything.
   */
  const requestLocation = useCallback(async ({ background = false } = {}) => {
    if (!background) {
      setLocating(true);
      setLocationError(null);
    }

    try {
      // A background pass exists precisely to notice movement, so it refuses a
      // cached fix. The first load may reuse a recent one and paint sooner.
      const coordinates = await getCurrentPosition(background ? { maximumAgeMs: 0 } : {});
      const timezone = deviceTimeZone();

      setLocation((previous) => {
        const next: StoredLocation = {
          ...coordinates,
          timezone,
          name:
            cachedPlaceName(coordinates.latitude, coordinates.longitude) ??
            // Keep the old name showing until the new one resolves, unless we
            // have actually moved — a blank line looks like a failure.
            (previous && distanceKm(previous, coordinates) < RESYNC_DISTANCE_KM
              ? previous.name
              : null),
          savedAt: Date.now(),
        };
        saveLocation(next);
        return next;
      });

      if (!background) setLocationError(null);

      const name = await reverseGeocode(coordinates.latitude, coordinates.longitude);
      if (name) {
        setLocation((previous) => {
          if (!previous) return previous;
          const named = { ...previous, name };
          saveLocation(named);
          return named;
        });
      }
    } catch (error) {
      if (!background) setLocationError(describeLocationError(error));
    } finally {
      if (!background) setLocating(false);
    }
  }, []);

  useEffect(() => {
    void requestLocation();
  }, [requestLocation]);

  /*
   * Travel is noticed on the way back in, not while the phone is in a pocket:
   * every time the app is brought to the foreground, and on a slow timer for
   * the case where it is simply left open.
   */
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void requestLocation({ background: true });
    };

    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, LOCATION_REFRESH_MS);

    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(timer);
    };
  }, [requestLocation]);

  const timeZone = location?.timezone ?? deviceTimeZone();

  const { year, month, day } = civilDate(now, timeZone);
  const dayKey = `${year}-${month}-${day}`;

  const prayerState: PrayerState = useMemo(() => {
    if (!location) return { status: 'pending' };

    const [y, m, d] = dayKey.split('-').map(Number);
    const civil = { year: y, month: m, day: d };
    const base = { latitude: location.latitude, longitude: location.longitude };

    try {
      const times = calculatePrayerTimesForCivilDate({ ...base, civil });
      if (checkPrayerTimes(times).length > 0) {
        return { status: 'failed', message: 'Unable to calculate prayer times for this location.' };
      }

      let lastThirdUpcoming: LastThirdResult | null = null;
      let tomorrowFajr: Date | null = null;
      try {
        const tomorrow = calculatePrayerTimesForCivilDate({ ...base, civil: addDays(civil, 1) });
        tomorrowFajr = tomorrow.fajr;
        lastThirdUpcoming = calculateLastThird({ maghrib: times.maghrib, nextFajr: tomorrow.fajr });
      } catch {
        lastThirdUpcoming = null;
      }

      let lastThirdInProgress: LastThirdResult | null = null;
      try {
        const yesterday = calculatePrayerTimesForCivilDate({ ...base, civil: addDays(civil, -1) });
        lastThirdInProgress = calculateLastThird({
          maghrib: yesterday.maghrib,
          nextFajr: times.fajr,
        });
      } catch {
        lastThirdInProgress = null;
      }

      return { status: 'ready', times, lastThirdInProgress, lastThirdUpcoming, tomorrowFajr };
    } catch (error) {
      if (error instanceof PrayerCalculationError && error.reason === 'undefined-events') {
        return {
          status: 'failed',
          message: 'The sun does not rise or set here today, so some prayer times cannot be calculated.',
        };
      }
      return { status: 'failed', message: 'Unable to calculate prayer times for this location.' };
    }
  }, [location, dayKey]);

  /*
   * Queued notifications are built from coordinates, so moving city invalidates
   * them: without this you would land in London and still be woken at Brooklyn's
   * Fajr. Runs on location change only — toggling a switch syncs on its own.
   */
  const lastSynced = useRef<{ latitude: number; longitude: number; timezone: string } | null>(null);

  useEffect(() => {
    if (!location || !anyEnabled(prefsRef.current)) return;

    const previous = lastSynced.current;
    const moved =
      !previous ||
      previous.timezone !== location.timezone ||
      distanceKm(previous, location) >= RESYNC_DISTANCE_KM;

    if (!moved) return;

    const target = {
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
    };
    lastSynced.current = target;

    void resyncSchedule({
      timezone: target.timezone,
      prefs: prefsRef.current,
      schedule: buildSchedule({ ...target, prefs: prefsRef.current }),
    }).catch(() => {
      // Offline, most likely. Try again on the next move or the next app open.
      lastSynced.current = previous;
    });
  }, [location]);

  const maghrib = prayerState.status === 'ready' ? prayerState.times.maghrib : null;

  const hijri = useMemo(
    () => currentHijriDate(now, maghrib, { timeZone, dayOffset: hijriOffset }),
    [now, maghrib, timeZone, hijriOffset],
  );
  const specialDay = useMemo(() => findSpecialDay(hijri), [hijri]);

  const qibla = useMemo(() => {
    if (!location) return null;
    if (!qiblaIsMeaningful(location.latitude, location.longitude)) return null;
    return calculateQiblaBearing(location.latitude, location.longitude);
  }, [location]);

  const next =
    prayerState.status === 'ready'
      ? findNextPrayer(prayerState.times, prayerState.tomorrowFajr, now)
      : null;

  const progress =
    prayerState.status === 'ready' && next ? windowProgress(prayerState.times, next, now) : null;

  const tahajjud =
    prayerState.status === 'ready'
      ? activeLastThird({
          now,
          todayFajr: prayerState.times.fajr,
          inProgress: prayerState.lastThirdInProgress,
          upcoming: prayerState.lastThirdUpcoming,
        })
      : null;

  const updatePrefs = useCallback((value: NotificationPrefs) => {
    setPrefs(value);
    saveNotificationPrefs(value);
  }, []);

  const updateHijriOffset = useCallback((value: HijriDayOffset) => {
    setHijriOffset(value);
    saveHijriOffset(value);
  }, []);

  return (
    <div className="page">
      <Header
        now={now}
        timeZone={timeZone}
        hijri={hijri}
        specialDay={specialDay}
        placeName={location?.name ?? null}
        hijriOffset={hijriOffset}
        onHijriOffsetChange={updateHijriOffset}
      />

      <main>
        {!location && (
          <Notice
            tone={locationError ? 'alert' : 'quiet'}
            action={{
              label: locating ? 'Finding you…' : 'Allow location',
              onClick: () => void requestLocation(),
              disabled: locating,
            }}
          >
            {locationError ?? 'Namaz needs your location to calculate prayer times. Nothing leaves your phone except a rounded position used to look up your city name.'}
          </Notice>
        )}

        {location && locationError && (
          <Notice
            tone="quiet"
            action={{
              label: 'Try again',
              onClick: () => void requestLocation(),
              disabled: locating,
            }}
          >
            {`${locationError} Showing your last known location.`}
          </Notice>
        )}

        {location && prayerState.status === 'failed' && (
          <Notice tone="alert">{prayerState.message}</Notice>
        )}

        {prayerState.status === 'ready' && (
          <PrayerTimesPanel
            times={prayerState.times}
            tahajjud={tahajjud}
            timeZone={timeZone}
            now={now}
            nextName={next && !next.tomorrow ? next.name : null}
            nextAt={next ? next.at : null}
            progress={progress}
          />
        )}

        {location && <QiblaPanel bearing={qibla} />}

        <NotificationsPanel
          prefs={prefs}
          onChange={updatePrefs}
          location={location}
          timeZone={timeZone}
          times={prayerState.status === 'ready' ? prayerState.times : null}
          tahajjud={tahajjud}
        />
      </main>

    </div>
  );
}
