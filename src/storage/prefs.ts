/**
 * Persisted user state (spec §22-24).
 *
 * Everything lives in localStorage on the device. Nothing here is uploaded except
 * the notification on/off flags, which the backend needs in order to know which
 * pushes to send.
 */

import type { HijriDayOffset } from '../calendar/hijri';

export const NOTIFIABLE_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'tahajjud'] as const;
export type NotifiablePrayer = (typeof NOTIFIABLE_PRAYERS)[number];

export type NotificationPrefs = Record<NotifiablePrayer, boolean>;

export interface StoredLocation {
  latitude: number;
  longitude: number;
  timezone: string;
  /** Human-readable name, e.g. "Brooklyn, New York". Never coordinates. */
  name: string | null;
  savedAt: number;
}

const KEYS = {
  notifications: 'namaz.notifications.v1',
  location: 'namaz.location.v1',
  hijriOffset: 'namaz.hijriOffset.v1',
} as const;

/** New installs start with every prayer off; the user opts in (spec §25). */
export function defaultNotificationPrefs(): NotificationPrefs {
  return {
    fajr: false,
    dhuhr: false,
    asr: false,
    maghrib: false,
    isha: false,
    tahajjud: false,
  };
}

export function allOn(): NotificationPrefs {
  return {
    fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true, tahajjud: true,
  };
}

export function allOff(): NotificationPrefs {
  return defaultNotificationPrefs();
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Safari in private mode can throw on access.
    return null;
  }
}

function readJson<T>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode. State stays correct for this session.
  }
}

export function loadNotificationPrefs(): NotificationPrefs {
  const stored = readJson<Partial<NotificationPrefs>>(KEYS.notifications);
  const prefs = defaultNotificationPrefs();
  if (!stored) return prefs;

  for (const prayer of NOTIFIABLE_PRAYERS) {
    if (typeof stored[prayer] === 'boolean') {
      prefs[prayer] = stored[prayer] as boolean;
    }
  }
  return prefs;
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  writeJson(KEYS.notifications, prefs);
}

export function togglePrayer(prefs: NotificationPrefs, prayer: NotifiablePrayer): NotificationPrefs {
  return { ...prefs, [prayer]: !prefs[prayer] };
}

export function anyEnabled(prefs: NotificationPrefs): boolean {
  return NOTIFIABLE_PRAYERS.some((prayer) => prefs[prayer]);
}

export function loadLocation(): StoredLocation | null {
  const stored = readJson<StoredLocation>(KEYS.location);
  if (!stored || typeof stored.latitude !== 'number' || typeof stored.longitude !== 'number') {
    return null;
  }
  return stored;
}

export function saveLocation(location: StoredLocation): void {
  writeJson(KEYS.location, location);
}

export function loadHijriOffset(): HijriDayOffset {
  const stored = readJson<number>(KEYS.hijriOffset);
  return stored === -1 || stored === 1 ? stored : 0;
}

export function saveHijriOffset(offset: HijriDayOffset): void {
  writeJson(KEYS.hijriOffset, offset);
}

/** Test helper. */
export const STORAGE_KEYS = KEYS;
