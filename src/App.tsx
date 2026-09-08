import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from './components/Header';
import Notice from './components/Notice';
import NotificationsPanel from './components/NotificationsPanel';
import PrayerTimesPanel from './components/PrayerTimesPanel';
import QiblaPanel from './components/QiblaPanel';
import TahajjudPanel from './components/TahajjudPanel';
import { currentHijriDate } from './calendar/hijri';
import { findSpecialDay } from './calendar/specialDays';
import { getCurrentPosition, LocationError } from './location/geolocation';
import { cachedPlaceName, reverseGeocode } from './location/reverseGeocode';
import {
  calculateNextDayPrayerTimes,
  calculatePrayerTimes,
  PrayerCalculationError,
  type PrayerTimesResult,
} from './prayer/engine';
import { checkPrayerTimes } from './prayer/sanity';
import { calculateLastThird, type LastThirdResult } from './prayer/tahajjud';
import { calculateQiblaBearing, qiblaIsMeaningful } from './qibla/bearing';
import {
  loadHijriOffset,
  loadLocation,
  loadNotificationPrefs,
  saveHijriOffset,
  saveLocation,
  saveNotificationPrefs,
  type NotificationPrefs,
  type StoredLocation,
} from './storage/prefs';
import { deviceTimeZone } from './utils/time';
import type { HijriDayOffset } from './calendar/hijri';

type PrayerState =
  | { status: 'pending' }
  | { status: 'ready'; times: PrayerTimesResult; tahajjud: LastThirdResult | null }
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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const requestLocation = useCallback(async () => {
    setLocating(true);
    setLocationError(null);

    try {
      const coordinates = await getCurrentPosition();
      const timezone = deviceTimeZone();
      const next: StoredLocation = {
        ...coordinates,
        timezone,
        name: cachedPlaceName(coordinates.latitude, coordinates.longitude),
        savedAt: Date.now(),
      };

      setLocation(next);
      saveLocation(next);

      const name = await reverseGeocode(coordinates.latitude, coordinates.longitude);
      if (name) {
        const named = { ...next, name };
        setLocation(named);
        saveLocation(named);
      }
    } catch (error) {
      setLocationError(describeLocationError(error));
    } finally {
      setLocating(false);
    }
  }, []);

  useEffect(() => {
    void requestLocation();
  }, [requestLocation]);

  const prayerState: PrayerState = useMemo(() => {
    if (!location) return { status: 'pending' };

    try {
      const input = {
        latitude: location.latitude,
        longitude: location.longitude,
        date: now,
        timezone: location.timezone,
      };

      const times = calculatePrayerTimes(input);
      const issues = checkPrayerTimes(times);
      if (issues.length > 0) {
        return { status: 'failed', message: 'Unable to calculate prayer times for this location.' };
      }

      let tahajjud: LastThirdResult | null = null;
      try {
        const tomorrow = calculateNextDayPrayerTimes(input);
        tahajjud = calculateLastThird({ maghrib: times.maghrib, nextFajr: tomorrow.fajr });
      } catch {
        tahajjud = null;
      }

      return { status: 'ready', times, tahajjud };
    } catch (error) {
      if (error instanceof PrayerCalculationError && error.reason === 'undefined-events') {
        return {
          status: 'failed',
          message: 'The sun does not rise or set here today, so some prayer times cannot be calculated.',
        };
      }
      return { status: 'failed', message: 'Unable to calculate prayer times for this location.' };
    }
  }, [location, now]);

  const maghrib = prayerState.status === 'ready' ? prayerState.times.maghrib : null;
  const timeZone = location?.timezone ?? deviceTimeZone();

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

  const updatePrefs = useCallback((next: NotificationPrefs) => {
    setPrefs(next);
    saveNotificationPrefs(next);
  }, []);

  const updateHijriOffset = useCallback((next: HijriDayOffset) => {
    setHijriOffset(next);
    saveHijriOffset(next);
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
            action={{ label: locating ? 'Finding you\u2026' : 'Allow location', onClick: requestLocation, disabled: locating }}
          >
            {locationError ?? 'Namaz needs your location to calculate prayer times. Nothing leaves your phone except a rounded position used to look up your city name.'}
          </Notice>
        )}

        {location && locationError && (
          <Notice tone="quiet" action={{ label: 'Try again', onClick: requestLocation, disabled: locating }}>
            {`${locationError} Showing your last known location.`}
          </Notice>
        )}

        {location && prayerState.status === 'failed' && (
          <Notice tone="alert">{prayerState.message}</Notice>
        )}

        {prayerState.status === 'ready' && (
          <>
            <PrayerTimesPanel times={prayerState.times} timeZone={timeZone} now={now} />
            <TahajjudPanel tahajjud={prayerState.tahajjud} timeZone={timeZone} />
          </>
        )}

        {location && <QiblaPanel bearing={qibla} />}

        <NotificationsPanel
          prefs={prefs}
          onChange={updatePrefs}
          location={location}
          timeZone={timeZone}
        />
      </main>

      <footer className="footnote">
        <p>
          Prayer times use the Islamic Society of North America method. The Hijri date is
          calculated and may differ by a day from your local moon sighting.
        </p>
      </footer>
    </div>
  );
}
