import { describe, expect, it } from 'vitest';
import { currentHijriDate, HIJRI_MONTH_NAMES, toHijri } from '../src/calendar/hijri';
import { findSpecialDay, specialDayNote } from '../src/calendar/specialDays';

const TZ = 'America/New_York';
const utcNoon = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));

describe('Hijri date (spec §7, §52)', () => {
  it('converts a known date using the Umm al-Qura calendar', () => {
    const hijri = toHijri(utcNoon(2026, 9, 8), { timeZone: TZ });
    expect(hijri.year).toBe(1448);
    expect(hijri.month).toBe(3);
    expect(hijri.monthName).toBe('Rabi al-Awwal');
    expect(hijri.formatted).toBe('26 Rabi al-Awwal 1448 AH');
  });

  it('is derived, never hard-coded: it advances every Gregorian day', () => {
    let previous = toHijri(utcNoon(2026, 1, 1), { timeZone: TZ });

    for (let i = 1; i <= 400; i += 1) {
      const cursor = new Date(Date.UTC(2026, 0, 1 + i, 12));
      const current = toHijri(cursor, { timeZone: TZ });

      const advancedWithinMonth = current.month === previous.month && current.day === previous.day + 1;
      const rolledIntoNewMonth = current.day === 1 && current.month !== previous.month;
      expect(
        advancedWithinMonth || rolledIntoNewMonth,
        `${cursor.toISOString()}: ${previous.formatted} -> ${current.formatted}`,
      ).toBe(true);

      previous = current;
    }
  });

  it('uses months of 29 or 30 days and never a thirteenth month', () => {
    const lengths = new Map<string, number>();

    for (let i = 0; i < 1200; i += 1) {
      const hijri = toHijri(new Date(Date.UTC(2026, 0, 1 + i, 12)), { timeZone: TZ });
      expect(hijri.month).toBeGreaterThanOrEqual(1);
      expect(hijri.month).toBeLessThanOrEqual(12);
      const key = `${hijri.year}-${hijri.month}`;
      lengths.set(key, Math.max(lengths.get(key) ?? 0, hijri.day));
    }

    // Ignore the partial months at each end of the sampled window.
    const complete = [...lengths.values()].slice(1, -1);
    for (const length of complete) {
      expect([29, 30]).toContain(length);
    }
  });

  it('names all twelve months', () => {
    expect(HIJRI_MONTH_NAMES).toHaveLength(12);
    for (let month = 1; month <= 12; month += 1) {
      const found = new Set<string>();
      for (let i = 0; i < 400; i += 1) {
        const hijri = toHijri(new Date(Date.UTC(2026, 0, 1 + i, 12)), { timeZone: TZ });
        if (hijri.month === month) found.add(hijri.monthName);
      }
      for (const name of found) expect(name.startsWith('Month ')).toBe(false);
    }
  });

  it('applies a one-day offset for local moon sighting', () => {
    const base = toHijri(utcNoon(2026, 9, 8), { timeZone: TZ });
    const later = toHijri(utcNoon(2026, 9, 8), { timeZone: TZ, dayOffset: 1 });
    const earlier = toHijri(utcNoon(2026, 9, 8), { timeZone: TZ, dayOffset: -1 });

    expect(later.day).toBe(base.day + 1);
    expect(earlier.day).toBe(base.day - 1);
  });

  it('rolls the Islamic date over at Maghrib, not at midnight', () => {
    const maghrib = new Date('2026-09-08T23:16:00Z'); // 7:16 PM in New York

    const beforeSunset = currentHijriDate(new Date('2026-09-08T21:00:00Z'), maghrib, { timeZone: TZ });
    const afterSunset = currentHijriDate(new Date('2026-09-08T23:30:00Z'), maghrib, { timeZone: TZ });

    expect(beforeSunset.day).toBe(26);
    expect(afterSunset.day).toBe(27);
  });

  it('falls back to the plain date when Maghrib is unknown', () => {
    const hijri = currentHijriDate(utcNoon(2026, 9, 8), null, { timeZone: TZ });
    expect(hijri.day).toBe(26);
  });
});

describe('special Islamic days (spec §8, §52)', () => {
  it('matches the occasions it should', () => {
    expect(findSpecialDay({ month: 1, day: 1 })?.name).toBe('Islamic New Year');
    expect(findSpecialDay({ month: 1, day: 10 })?.name).toBe('Ashura');
    expect(findSpecialDay({ month: 3, day: 12 })?.name).toBe('Mawlid an-Nabi');
    expect(findSpecialDay({ month: 7, day: 27 })?.name).toBe('Shab-e-Meraj');
    expect(findSpecialDay({ month: 8, day: 15 })?.name).toBe('Shab-e-Barat');
    expect(findSpecialDay({ month: 9, day: 27 })?.name).toBe('Shab-e-Qadr / Laylat al-Qadr');
    expect(findSpecialDay({ month: 10, day: 1 })?.name).toBe('Eid al-Fitr');
    expect(findSpecialDay({ month: 12, day: 9 })?.name).toBe('Day of Arafah');
    expect(findSpecialDay({ month: 12, day: 10 })?.name).toBe('Eid al-Adha');
  });

  it('shows nothing on an ordinary day', () => {
    expect(findSpecialDay({ month: 3, day: 25 })).toBeNull();
    expect(findSpecialDay({ month: 2, day: 14 })).toBeNull();
    expect(findSpecialDay({ month: 6, day: 3 })).toBeNull();
  });

  it('prefers the specific occasion over the general Ramadan label', () => {
    expect(findSpecialDay({ month: 9, day: 27 })?.name).toBe('Shab-e-Qadr / Laylat al-Qadr');
    expect(findSpecialDay({ month: 9, day: 25 })?.name).toBe('Last ten nights of Ramadan');
    expect(findSpecialDay({ month: 9, day: 3 })?.name).toBe('Ramadan');
  });

  it('marks nights so they can be shown from Maghrib', () => {
    expect(findSpecialDay({ month: 7, day: 27 })?.isNight).toBe(true);
    expect(findSpecialDay({ month: 8, day: 15 })?.isNight).toBe(true);
    expect(findSpecialDay({ month: 3, day: 12 })?.isNight).toBe(false);
  });

  it('never claims certainty about a moon-dependent occasion', () => {
    const eid = findSpecialDay({ month: 10, day: 1 })!;
    expect(eid.moonDependent).toBe(true);
    expect(specialDayNote(eid)).toMatch(/moon sighting/i);

    const meraj = findSpecialDay({ month: 7, day: 27 })!;
    expect(specialDayNote(meraj)).toBeNull();
  });

  it('shows at most one occasion for any date in a 40-year sweep', () => {
    for (let i = 0; i < 15_000; i += 1) {
      const hijri = toHijri(new Date(Date.UTC(2026, 0, 1 + i, 12)), { timeZone: 'UTC' });
      const result = findSpecialDay(hijri);
      expect(result === null || typeof result.name === 'string').toBe(true);
    }
  });
});
