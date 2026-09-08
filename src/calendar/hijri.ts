/**
 * Hijri date (spec §7).
 *
 * Source: the platform's own ICU implementation of the Umm al-Qura calendar via
 * Intl.DateTimeFormat("...-u-ca-islamic-umalqura"). No hard-coded dates, no
 * hand-rolled lunar arithmetic, and nothing to keep up to date.
 *
 * Umm al-Qura is a *calculated* calendar. Local moon sighting can differ from it
 * by a day, and the four Islamic calendars ICU ships disagree with each other:
 * for 8 September 2026 umalqura and tbla give 25 Rabi al-Awwal, civil gives 24,
 * and the observational approximation gives 26. The UI says the date is
 * calculated, and `dayOffset` lets a user nudge it by a day to match their local
 * announcement.
 */

export interface HijriDate {
  day: number;
  /** 1-12. */
  month: number;
  year: number;
  monthName: string;
  /** e.g. "25 Rabi al-Awwal 1448 AH" */
  formatted: string;
}

export const HIJRI_MONTH_NAMES = [
  'Muharram',
  'Safar',
  'Rabi al-Awwal',
  'Rabi al-Thani',
  'Jumada al-Ula',
  'Jumada al-Akhirah',
  'Rajab',
  "Sha'ban",
  'Ramadan',
  'Shawwal',
  'Dhul Qadah',
  'Dhul Hijjah',
] as const;

export const HIJRI_CALENDAR = 'islamic-umalqura';

/** Offsets a user may apply to match a local moon-sighting announcement. */
export type HijriDayOffset = -1 | 0 | 1;

export interface HijriOptions {
  timeZone?: string;
  dayOffset?: HijriDayOffset;
}

export function toHijri(instant: Date, options: HijriOptions = {}): HijriDate {
  const { timeZone, dayOffset = 0 } = options;

  const shifted = new Date(instant.getTime() + dayOffset * 86_400_000);

  const parts = new Intl.DateTimeFormat(`en-US-u-ca-${HIJRI_CALENDAR}`, {
    timeZone,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(shifted);

  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);

  const day = get('day');
  const month = get('month');
  const year = get('year');
  const monthName = HIJRI_MONTH_NAMES[month - 1] ?? `Month ${month}`;

  return {
    day,
    month,
    year,
    monthName,
    formatted: `${day} ${monthName} ${year} AH`,
  };
}

/**
 * The Islamic date *currently in force*, given that the Islamic day begins at
 * sunset. Before Maghrib this is today's Hijri date; from Maghrib onwards it is
 * tomorrow's. This is what makes "night of" observances such as Shab-e-Barat
 * appear on the correct evening.
 */
export function currentHijriDate(
  now: Date,
  maghribToday: Date | null,
  options: HijriOptions = {},
): HijriDate {
  const afterSunset = maghribToday !== null && now.getTime() >= maghribToday.getTime();
  const reference = afterSunset ? new Date(now.getTime() + 86_400_000) : now;
  return toHijri(reference, options);
}
