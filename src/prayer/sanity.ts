/**
 * Sanity checks (spec §16, §47).
 *
 * The engine can be wired up wrongly in ways that still produce plausible-looking
 * Date objects — an Asr at 10:17 PM being the canonical example. These checks run
 * on every calculation, in tests and at runtime, and the UI refuses to render a
 * set of times that fails them.
 */

import { PRAYER_ORDER, type PrayerName, type PrayerTimesResult } from './engine';

export interface SanityIssue {
  code: 'out-of-order' | 'asr-implausible' | 'night-implausible';
  message: string;
}

/** Fajr < Sunrise < Dhuhr < Asr < Maghrib < Isha. */
export function checkOrdering(times: PrayerTimesResult): SanityIssue[] {
  const issues: SanityIssue[] = [];

  for (let i = 1; i < PRAYER_ORDER.length; i += 1) {
    const previous = PRAYER_ORDER[i - 1] as PrayerName;
    const current = PRAYER_ORDER[i] as PrayerName;

    if (times[current].getTime() <= times[previous].getTime()) {
      issues.push({
        code: 'out-of-order',
        message: `${current} (${times[current].toISOString()}) is not after ${previous} (${times[previous].toISOString()})`,
      });
    }
  }

  return issues;
}

/**
 * Asr must sit strictly between Dhuhr and Maghrib. Both bounds are astronomical
 * facts, not preferences: the Asr shadow ratio is only reached after solar noon
 * and always before sunset. An evening Asr means the altitude/zenith conversion
 * is inverted.
 */
export function checkAsr(times: PrayerTimesResult): SanityIssue[] {
  const asr = times.asr.getTime();

  if (asr <= times.dhuhr.getTime() || asr >= times.maghrib.getTime()) {
    return [
      {
        code: 'asr-implausible',
        message: `Asr ${times.asr.toISOString()} falls outside (Dhuhr, Maghrib) = (${times.dhuhr.toISOString()}, ${times.maghrib.toISOString()})`,
      },
    ];
  }

  return [];
}

/** Night length between Maghrib and the next Fajr must be a plausible duration. */
export function checkNightLength(maghrib: Date, nextFajr: Date): SanityIssue[] {
  const hours = (nextFajr.getTime() - maghrib.getTime()) / 3_600_000;

  if (!(hours > 0)) {
    return [{ code: 'night-implausible', message: 'Next Fajr is not after Maghrib' }];
  }
  if (hours > 22) {
    return [{ code: 'night-implausible', message: `Night length of ${hours.toFixed(2)}h is implausible` }];
  }

  return [];
}

export function checkPrayerTimes(times: PrayerTimesResult): SanityIssue[] {
  return [...checkOrdering(times), ...checkAsr(times)];
}

export function assertPrayerTimesSane(times: PrayerTimesResult): void {
  const issues = checkPrayerTimes(times);
  if (issues.length > 0) {
    throw new Error(`Prayer time sanity check failed:\n${issues.map((i) => `  - ${i.message}`).join('\n')}`);
  }
}
