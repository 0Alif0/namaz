import { describe, expect, it } from 'vitest';
import {
  calculatePrayerTimes,
  calculatePrayerTimesForCivilDate,
  describeParameters,
  PRAYER_ORDER,
  PrayerCalculationError,
  type PrayerName,
} from '../src/prayer/engine';
import { checkAsr, checkOrdering, checkPrayerTimes } from '../src/prayer/sanity';
import { formatTime } from '../src/utils/format';
import { zoneAbbreviation } from '../src/utils/time';

const NY = { latitude: 40.64, longitude: -73.98, timezone: 'America/New_York' };

/** Noon UTC on the given civil date — unambiguous regardless of the test runner's TZ. */
const utcNoon = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day, 12));

const minutesBetween = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 60_000;

/** Parses "5:13 AM" on the given civil date in the given zone into an instant. */
function referenceInstant(
  year: number, month: number, day: number, clock: string, timeZone: string,
): Date {
  const [, hourText, minuteText, meridiem] = clock.match(/^(\d+):(\d+)\s*(AM|PM)$/i)!;
  let hour = Number(hourText) % 12;
  if (meridiem.toUpperCase() === 'PM') hour += 12;

  // Try each UTC hour offset and keep the one that renders back to the wanted clock time.
  for (let offset = -14; offset <= 14; offset += 0.25) {
    const candidate = new Date(Date.UTC(year, month - 1, day, hour, Number(minuteText)) + offset * 3_600_000);
    const rendered = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(candidate);
    const expected = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(Date.UTC(year, month - 1, day, hour, Number(minuteText))));
    if (rendered === expected) return candidate;
  }
  throw new Error(`Could not resolve ${clock} on ${year}-${month}-${day} in ${timeZone}`);
}

describe('ISNA configuration (spec §13)', () => {
  it('uses the parameters ISNA publishes, read from adhan rather than assumed', () => {
    const params = describeParameters('standard', NY.latitude);

    expect(params.method).toBe('NorthAmerica');
    expect(params.fajrAngle).toBe(15);
    expect(params.ishaAngle).toBe(15);
    expect(params.ishaInterval).toBe(0);
    expect(params.madhab).toBe('shafi');
    expect(params.rounding).toBe('nearest');
    expect(params.adjustments).toEqual({
      fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0,
    });
  });

  it('applies no hidden minute offsets to make references match', () => {
    expect(describeParameters('standard', NY.latitude).adjustments).toEqual(
      describeParameters('hanafi', NY.latitude).adjustments,
    );
  });
});

describe('New York, 8 September 2026 (spec §14, §46)', () => {
  const reference: Record<PrayerName, string> = {
    fajr: '5:13 AM',
    sunrise: '6:28 AM',
    dhuhr: '12:54 PM',
    asr: '4:30 PM',
    maghrib: '7:17 PM',
    isha: '8:34 PM',
  };

  const times = calculatePrayerTimes({ ...NY, date: utcNoon(2026, 9, 8) });

  it('reports each calculated value and its difference from the reference', () => {
    const rows = PRAYER_ORDER.map((prayer) => {
      const calculated = times[prayer];
      const expected = referenceInstant(2026, 9, 8, reference[prayer], NY.timezone);
      const delta = Math.round((calculated.getTime() - expected.getTime()) / 60_000);
      return {
        prayer,
        calculated: formatTime(calculated, NY.timezone),
        reference: reference[prayer],
        deltaMinutes: delta,
      };
    });

    // Printed on every run so a regression is visible, not just a pass/fail.
    // eslint-disable-next-line no-console
    console.table(rows);

    for (const row of rows) {
      expect(
        Math.abs(row.deltaMinutes),
        `${row.prayer}: calculated ${row.calculated}, reference ${row.reference}`,
      ).toBeLessThanOrEqual(3);
    }
  });

  it('produces times in the correct order', () => {
    expect(checkOrdering(times)).toEqual([]);
  });

  it('is not affected by the timezone of the process running it', () => {
    const sameDayViaCivil = calculatePrayerTimesForCivilDate({
      latitude: NY.latitude,
      longitude: NY.longitude,
      civil: { year: 2026, month: 9, day: 8 },
    });
    expect(sameDayViaCivil.dhuhr.getTime()).toBe(times.dhuhr.getTime());
  });
});

describe('Asr (spec §15, §47)', () => {
  const times = calculatePrayerTimes({ ...NY, date: utcNoon(2026, 9, 8) });

  it('falls in the afternoon, not the evening', () => {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: NY.timezone, hour: 'numeric', hour12: false })
        .format(times.asr),
    );
    expect(hour).toBeGreaterThanOrEqual(12);
    expect(hour).toBeLessThan(19);
  });

  it('sits strictly between Dhuhr and Maghrib', () => {
    expect(checkAsr(times)).toEqual([]);
  });

  it('rejects an obviously invalid evening Asr such as 10:17 PM', () => {
    const broken = { ...times, asr: referenceInstant(2026, 9, 8, '10:17 PM', NY.timezone) };
    const issues = checkAsr(broken);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('asr-implausible');
  });

  it('distinguishes the Hanafi shadow factor from the standard one', () => {
    const hanafi = calculatePrayerTimes({ ...NY, date: utcNoon(2026, 9, 8), asrMethod: 'hanafi' });

    // Two shadow lengths, so Hanafi Asr is always later — but still before Maghrib.
    expect(hanafi.asr.getTime()).toBeGreaterThan(times.asr.getTime());
    expect(hanafi.asr.getTime()).toBeLessThan(times.maghrib.getTime());
    expect(minutesBetween(hanafi.asr, times.asr)).toBeGreaterThan(20);
  });
});

describe('ordering holds all year in many places (spec §16)', () => {
  const cities = [
    { name: 'New York', latitude: 40.64, longitude: -73.98 },
    { name: 'London', latitude: 51.5074, longitude: -0.1278 },
    { name: 'Los Angeles', latitude: 34.0522, longitude: -118.2437 },
    { name: 'Tokyo', latitude: 35.6762, longitude: 139.6503 },
    { name: 'Makkah', latitude: 21.4225, longitude: 39.8262 },
    { name: 'Dhaka', latitude: 23.8103, longitude: 90.4125 },
    { name: 'Cape Town', latitude: -33.9249, longitude: 18.4241 },
    { name: 'Jakarta', latitude: -6.2088, longitude: 106.8456 },
  ];

  for (const city of cities) {
    it(`${city.name}: 365 days in order with a plausible Asr`, () => {
      const failures: string[] = [];

      for (let dayOfYear = 0; dayOfYear < 365; dayOfYear += 1) {
        const cursor = new Date(Date.UTC(2026, 0, 1 + dayOfYear));
        const civil = {
          year: cursor.getUTCFullYear(),
          month: cursor.getUTCMonth() + 1,
          day: cursor.getUTCDate(),
        };

        const times = calculatePrayerTimesForCivilDate({
          latitude: city.latitude, longitude: city.longitude, civil,
        });

        for (const issue of checkPrayerTimes(times)) {
          failures.push(`${civil.year}-${civil.month}-${civil.day}: ${issue.message}`);
        }
      }

      expect(failures).toEqual([]);
    });
  }
});

describe('timezone and daylight saving (spec §17, §49)', () => {
  it('uses EST before the spring transition and EDT after it', () => {
    const before = calculatePrayerTimes({ ...NY, date: utcNoon(2026, 3, 7) });
    const after = calculatePrayerTimes({ ...NY, date: utcNoon(2026, 3, 8) });

    expect(zoneAbbreviation(before.dhuhr, NY.timezone)).toBe('EST');
    expect(zoneAbbreviation(after.dhuhr, NY.timezone)).toBe('EDT');

    // Solar noon barely moves day to day, so the wall clock must jump ~1 hour.
    expect(formatTime(before.dhuhr, NY.timezone)).toBe('12:08 PM');
    expect(formatTime(after.dhuhr, NY.timezone)).toBe('1:08 PM');

    // The underlying instants are only minutes apart in absolute terms.
    const absoluteShift = Math.abs(
      (after.dhuhr.getTime() - before.dhuhr.getTime()) - 24 * 3_600_000,
    ) / 60_000;
    expect(absoluteShift).toBeLessThan(5);
  });

  it('uses EDT before the autumn transition and EST after it', () => {
    const before = calculatePrayerTimes({ ...NY, date: utcNoon(2026, 10, 31) });
    const after = calculatePrayerTimes({ ...NY, date: utcNoon(2026, 11, 2) });

    expect(zoneAbbreviation(before.dhuhr, NY.timezone)).toBe('EDT');
    expect(zoneAbbreviation(after.dhuhr, NY.timezone)).toBe('EST');
  });

  it('handles a zone with no daylight saving', () => {
    const phoenix = { latitude: 33.4484, longitude: -112.074, timezone: 'America/Phoenix' };
    const winter = calculatePrayerTimes({ ...phoenix, date: utcNoon(2026, 1, 15) });
    const summer = calculatePrayerTimes({ ...phoenix, date: utcNoon(2026, 7, 15) });

    expect(zoneAbbreviation(winter.dhuhr, phoenix.timezone)).toBe('MST');
    expect(zoneAbbreviation(summer.dhuhr, phoenix.timezone)).toBe('MST');
  });

  it('resolves the correct civil day across the midnight boundary', () => {
    // 03:00 UTC on 9 September is 11 PM on 8 September in New York (EDT, UTC-4).
    const lateEvening = calculatePrayerTimes({
      ...NY, date: new Date(Date.UTC(2026, 8, 9, 3)),
    });
    const midday = calculatePrayerTimes({ ...NY, date: utcNoon(2026, 9, 8) });
    expect(lateEvening.dhuhr.getTime()).toBe(midday.dhuhr.getTime());
  });

  it('works for past and future dates', () => {
    for (const year of [1990, 2005, 2040]) {
      const times = calculatePrayerTimes({ ...NY, date: utcNoon(year, 6, 15) });
      expect(checkPrayerTimes(times)).toEqual([]);
    }
  });
});

describe('high latitude (spec §50)', () => {
  const tromso = { latitude: 69.6492, longitude: 18.9553, timezone: 'Europe/Oslo' };

  it('applies a high-latitude rule automatically above 48 degrees', () => {
    expect(describeParameters('standard', 69.65).highLatitudeRule).toBe('seventhofthenight');
    expect(describeParameters('standard', 40.64).highLatitudeRule).toBe('middleofthenight');
  });

  it('produces ordered times at Tromso in September rather than a collapsed night', () => {
    const times = calculatePrayerTimes({ ...tromso, date: utcNoon(2026, 9, 8) });
    expect(checkPrayerTimes(times)).toEqual([]);

    // With ISNA's own MiddleOfTheNight rule this night collapses to ~4 minutes.
    const nightMinutes = minutesBetween(times.isha, times.fajr);
    expect(nightMinutes).toBeGreaterThan(60);
  });

  it('refuses to invent times during polar day instead of returning placeholders', () => {
    expect(() => calculatePrayerTimes({ ...tromso, date: utcNoon(2026, 6, 21) })).toThrow(
      PrayerCalculationError,
    );

    try {
      calculatePrayerTimes({ ...tromso, date: utcNoon(2026, 6, 21) });
    } catch (error) {
      expect((error as PrayerCalculationError).reason).toBe('undefined-events');
    }
  });

  it('refuses to invent times during polar night', () => {
    const longyearbyen = { latitude: 78.2232, longitude: 15.6469, timezone: 'Europe/Oslo' };
    expect(() => calculatePrayerTimes({ ...longyearbyen, date: utcNoon(2026, 12, 21) })).toThrow(
      PrayerCalculationError,
    );
  });
});

describe('input validation (spec §51)', () => {
  it('rejects impossible coordinates instead of returning a time', () => {
    expect(() => calculatePrayerTimes({ ...NY, latitude: 91, date: utcNoon(2026, 9, 8) })).toThrow();
    expect(() => calculatePrayerTimes({ ...NY, longitude: 200, date: utcNoon(2026, 9, 8) })).toThrow();
    expect(() => calculatePrayerTimes({ ...NY, latitude: Number.NaN, date: utcNoon(2026, 9, 8) })).toThrow();
  });

  it('rejects an invalid date', () => {
    expect(() => calculatePrayerTimes({ ...NY, date: new Date('nonsense') })).toThrow();
  });
});
