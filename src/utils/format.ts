/** Display formatting. No calculation happens here. */

export function formatTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(instant);
}

/** "Tuesday, September 8" — the year is deliberately not shown (spec §6). */
export function formatGregorianDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(instant);
}

/** "2:46 AM – 5:13 AM" */
export function formatTimeRange(start: Date, end: Date, timeZone: string): string {
  return `${formatTime(start, timeZone)} \u2013 ${formatTime(end, timeZone)}`;
}

export function formatBearing(bearing: number): string {
  return `${Math.round(bearing)}\u00B0`;
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

/**
 * "in 1 hour 12 minutes" / "in 42 minutes" / "in 30 seconds".
 * Written out rather than abbreviated: the screen is calm, not a stopwatch.
 */
export function formatCountdown(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000));

  if (total < 60) return `in ${plural(total, 'second')}`;

  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `in ${plural(minutes, 'minute')}`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? `in ${plural(hours, 'hour')}`
    : `in ${plural(hours, 'hour')} ${plural(rest, 'minute')}`;
}

/** "Tuesday" \u2014 used to say which day tomorrow's Fajr falls on. */
export function formatWeekday(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'long' }).format(instant);
}
