/**
 * Timezone helpers.
 *
 * These exist because `adhan` reads only the year/month/day of the Date object
 * you hand it, and it reads them with `getFullYear()` / `getMonth()` /
 * `getDate()` — i.e. in the *runtime's* local timezone. On the user's phone the
 * runtime zone and the user's zone are the same, so that is harmless. In Node
 * (tests, or a server) they are usually not the same, and a naive
 * `new Date(2026, 8, 8)` in a UTC process is 8 September 00:00 UTC, which is
 * 7 September in New York.
 *
 * `civilDate()` resolves the calendar date as seen in a specific IANA zone, and
 * `asRuntimeLocalDate()` rebuilds it as a runtime-local Date so adhan reads the
 * digits we intended. Nothing here does arithmetic on UTC offsets by hand.
 */

export interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number;
}

/** The calendar date that `instant` falls on, as seen in `timeZone`. */
export function civilDate(instant: Date, timeZone: string): CivilDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * A Date whose *runtime-local* year/month/day equal the given civil date.
 * Only the calendar digits are meaningful; the clock portion is midnight and is
 * ignored by the prayer engine.
 */
export function asRuntimeLocalDate(date: CivilDate): Date {
  return new Date(date.year, date.month - 1, date.day, 12, 0, 0, 0);
}

/** The civil date `days` after (or before, if negative) the given one. */
export function addDays(date: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The device's IANA timezone, e.g. "America/New_York". */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** The short zone abbreviation in effect at `instant`, e.g. "EDT". Diagnostics only. */
export function zoneAbbreviation(instant: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(instant)
    .find((p) => p.type === 'timeZoneName');
  return part ? part.value : '';
}

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
