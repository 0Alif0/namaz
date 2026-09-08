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
