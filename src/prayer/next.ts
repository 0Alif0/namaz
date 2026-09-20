/**
 * Which prayer is now, and which is next.
 *
 * Kept out of the components so it can be tested without a DOM, in keeping with
 * the rest of `prayer/` — nothing here imports React.
 */

import { PRAYER_ORDER, type PrayerName, type PrayerTimesResult } from './engine';

export interface NextPrayer {
  name: PrayerName;
  at: Date;
  /** Tomorrow's Fajr rather than something still to come today. */
  tomorrow: boolean;
}

/** The most recent event to have passed, sunrise included. */
function lastElapsed(times: PrayerTimesResult, now: Date): PrayerName | null {
  let found: PrayerName | null = null;
  for (const name of PRAYER_ORDER) {
    if (times[name].getTime() <= now.getTime()) found = name;
  }
  return found;
}

/**
 * The prayer whose window is currently open, or null when none is.
 *
 * Before Fajr the answer is Isha: the window opened last night and runs until
 * Fajr, so those hours belong to it even though today's Isha time is still ahead
 * on the clock.
 *
 * Null only between sunrise and Dhuhr, where no window is open at all — sunrise
 * ends Fajr rather than beginning anything, so marking it would claim a prayer
 * that is not due.
 */
export function currentPrayer(times: PrayerTimesResult, now: Date): PrayerName | null {
  const last = lastElapsed(times, now);

  if (last === null) return 'isha';
  return last === 'sunrise' ? null : last;
}

export function findNextPrayer(
  times: PrayerTimesResult,
  tomorrowFajr: Date | null,
  now: Date,
): NextPrayer | null {
  for (const name of PRAYER_ORDER) {
    if (times[name].getTime() > now.getTime()) {
      return { name, at: times[name], tomorrow: false };
    }
  }

  if (tomorrowFajr && tomorrowFajr.getTime() > now.getTime()) {
    return { name: 'fajr', at: tomorrowFajr, tomorrow: true };
  }

  return null;
}

/**
 * How far through the current gap we are, 0 to 1, for the progress hairline.
 * Measured from the last event that passed — sunrise included, since the bar
 * shows elapsed time rather than an open prayer window. Null before the day's
 * first event, where there is no start to measure from.
 */
export function windowProgress(
  times: PrayerTimesResult,
  next: NextPrayer,
  now: Date,
): number | null {
  const current = lastElapsed(times, now);
  if (!current) return null;

  const start = times[current].getTime();
  const span = next.at.getTime() - start;
  if (span <= 0) return null;

  return Math.min(1, Math.max(0, (now.getTime() - start) / span));
}

/** A filled "now" row for an open window; a lighter "next" row when none is. */
export type HighlightKind = 'now' | 'next';

export interface Highlight {
  name: PrayerName;
  kind: HighlightKind;
}

/**
 * Which row the list should highlight, and how.
 *
 * An open window always wins, and is the only thing marked while it lasts: the
 * next prayer already carries a countdown, so highlighting it too would put two
 * anchors on one short list.
 *
 * Between sunrise and Dhuhr no window is open, which used to leave the list with
 * nothing marked for the several hours that gap runs. The prayer being waited on
 * is highlighted there instead — as "next", never as "now", so the list still
 * says plainly that nothing is currently due.
 */
export function highlightedPrayer(
  times: PrayerTimesResult,
  nextName: PrayerName | null,
  now: Date,
): Highlight | null {
  const current = currentPrayer(times, now);
  if (current !== null) return { name: current, kind: 'now' };
  if (nextName !== null) return { name: nextName, kind: 'next' };
  return null;
}
