/**
 * Notification schedule (spec §26).
 *
 * The phone computes prayer times and uploads only *instants* — no coordinates.
 * The backend stores a list of "send this push at this UTC moment" rows and a
 * per-minute cron dispatches them. That satisfies both §26 (the backend really
 * sends the push) and §10 (no precise location on a server).
 */

import {
  calculatePrayerTimesForCivilDate,
  type AsrMethod,
  type CalculationMethodName,
} from '../prayer/engine';
import { calculateLastThird } from '../prayer/tahajjud';
import { checkPrayerTimes } from '../prayer/sanity';
import { addDays, civilDate } from '../utils/time';
import { NOTIFIABLE_PRAYERS, type NotifiablePrayer, type NotificationPrefs } from '../storage/prefs';

/** How far ahead the phone schedules. Refreshed on every app open. */
export const SCHEDULE_HORIZON_DAYS = 7;

export interface ScheduleEntry {
  prayer: NotifiablePrayer;
  /** ISO-8601 UTC instant. */
  fireAt: string;
}

export interface BuildScheduleInput {
  latitude: number;
  longitude: number;
  timezone: string;
  prefs: NotificationPrefs;
  from?: Date;
  days?: number;
  calculationMethod?: CalculationMethodName;
  asrMethod?: AsrMethod;
}

/**
 * Prayer instants for the next `days` days, filtered to enabled prayers and to
 * moments still in the future. Days that cannot be calculated (polar day/night)
 * or that fail a sanity check are skipped rather than scheduled with bad times.
 */
export function buildSchedule(input: BuildScheduleInput): ScheduleEntry[] {
  const {
    latitude,
    longitude,
    timezone,
    prefs,
    from = new Date(),
    days = SCHEDULE_HORIZON_DAYS,
    calculationMethod,
    asrMethod,
  } = input;

  const enabled = NOTIFIABLE_PRAYERS.filter((prayer) => prefs[prayer]);
  if (enabled.length === 0) return [];

  const entries: ScheduleEntry[] = [];
  const startCivil = civilDate(from, timezone);

  for (let offset = 0; offset < days; offset += 1) {
    const civil = addDays(startCivil, offset);

    let times;
    try {
      times = calculatePrayerTimesForCivilDate({
        latitude, longitude, civil, calculationMethod, asrMethod,
      });
    } catch {
      continue;
    }

    if (checkPrayerTimes(times).length > 0) continue;

    for (const prayer of enabled) {
      if (prayer === 'tahajjud') continue;
      entries.push({ prayer, fireAt: times[prayer].toISOString() });
    }

    if (prefs.tahajjud) {
      try {
        const next = calculatePrayerTimesForCivilDate({
          latitude, longitude, civil: addDays(civil, 1), calculationMethod, asrMethod,
        });
        const { lastThirdStart } = calculateLastThird({
          maghrib: times.maghrib,
          nextFajr: next.fajr,
        });
        entries.push({ prayer: 'tahajjud', fireAt: lastThirdStart.toISOString() });
      } catch {
        // No usable night boundary for this date; skip Tahajjud only.
      }
    }
  }

  const cutoff = from.getTime();
  return entries
    .filter((entry) => Date.parse(entry.fireAt) > cutoff)
    .sort((a, b) => Date.parse(a.fireAt) - Date.parse(b.fireAt));
}

export const PRAYER_LABELS: Record<NotifiablePrayer, string> = {
  fajr: 'Fajr',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
  tahajjud: 'Tahajjud',
};
