import { describe, expect, it } from 'vitest';
import { calculateLastThird } from '../src/prayer/tahajjud';
import { calculatePrayerTimesForCivilDate } from '../src/prayer/engine';
import { checkNightLength } from '../src/prayer/sanity';
import { formatTime, formatTimeRange } from '../src/utils/format';

const NY = { latitude: 40.64, longitude: -73.98 };
const TZ = 'America/New_York';

describe('last third of the night (spec §18, §43)', () => {
  it('divides the night by exactly two thirds', () => {
    const maghrib = new Date('2026-09-08T23:16:00Z');
    const nextFajr = new Date('2026-09-09T09:14:00Z');

    const result = calculateLastThird({ maghrib, nextFajr });
    const total = nextFajr.getTime() - maghrib.getTime();

    expect(result.nightStart.getTime()).toBe(maghrib.getTime());
    expect(result.nightEnd.getTime()).toBe(nextFajr.getTime());
    expect(result.nightDurationMs).toBe(total);
    expect(result.lastThirdStart.getTime() - maghrib.getTime()).toBeCloseTo((total * 2) / 3, -1);

    // The remaining segment is one third of the night.
    const remaining = nextFajr.getTime() - result.lastThirdStart.getTime();
    expect(remaining / total).toBeCloseTo(1 / 3, 6);
  });

  it('computes New York on 8 September 2026 from real prayer times', () => {
    const today = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 9, day: 8 } });
    const tomorrow = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 9, day: 9 } });

    const result = calculateLastThird({ maghrib: today.maghrib, nextFajr: tomorrow.fajr });

    expect(checkNightLength(today.maghrib, tomorrow.fajr)).toEqual([]);

    const hours = result.nightDurationMs / 3_600_000;
    expect(hours).toBeGreaterThan(9);
    expect(hours).toBeLessThan(11);

    // eslint-disable-next-line no-console
    console.log(
      `  Tahajjud, New York 2026-09-08: ${formatTimeRange(result.lastThirdStart, result.nightEnd, TZ)}` +
      ` (night ${hours.toFixed(2)}h from Maghrib ${formatTime(today.maghrib, TZ)})`,
    );

    // Maghrib -> next Fajr, per the written rule in §18.
    expect(formatTime(result.lastThirdStart, TZ)).toBe('1:54 AM');
    expect(formatTime(result.nightEnd, TZ)).toBe('5:14 AM');
  });

  it("documents that the spec's worked example uses the sunset-to-sunrise definition", () => {
    const today = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 9, day: 8 } });
    const tomorrow = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 9, day: 9 } });

    const sunsetToSunrise = calculateLastThird({
      maghrib: today.maghrib,
      nextFajr: tomorrow.sunrise,
    });

    // This reproduces the 2:46 AM in the spec's worked example exactly.
    expect(formatTime(sunsetToSunrise.lastThirdStart, TZ)).toBe('2:46 AM');
  });

  it('holds across a daylight saving transition', () => {
    const before = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 3, day: 7 } });
    const after = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 3, day: 8 } });

    const result = calculateLastThird({ maghrib: before.maghrib, nextFajr: after.fajr });
    const hours = result.nightDurationMs / 3_600_000;

    // The clock jumps an hour that night, so the wall-clock night looks an hour
    // shorter while the real elapsed night is still ~11 hours.
    expect(hours).toBeGreaterThan(10);
    expect(hours).toBeLessThan(12);
    expect(result.lastThirdStart.getTime()).toBeGreaterThan(before.maghrib.getTime());
    expect(result.lastThirdStart.getTime()).toBeLessThan(after.fajr.getTime());
  });

  it('holds through the winter and summer extremes', () => {
    for (const civil of [
      { year: 2026, month: 6, day: 21 },
      { year: 2026, month: 12, day: 21 },
    ]) {
      const next = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + 1));
      const today = calculatePrayerTimesForCivilDate({ ...NY, civil });
      const tomorrow = calculatePrayerTimesForCivilDate({
        ...NY,
        civil: {
          year: next.getUTCFullYear(),
          month: next.getUTCMonth() + 1,
          day: next.getUTCDate(),
        },
      });

      const result = calculateLastThird({ maghrib: today.maghrib, nextFajr: tomorrow.fajr });
      expect(result.lastThirdStart.getTime()).toBeGreaterThan(today.maghrib.getTime());
      expect(result.lastThirdStart.getTime()).toBeLessThan(tomorrow.fajr.getTime());
    }
  });

  it('refuses to produce a night that runs backwards', () => {
    expect(() =>
      calculateLastThird({
        maghrib: new Date('2026-09-09T09:14:00Z'),
        nextFajr: new Date('2026-09-08T23:16:00Z'),
      }),
    ).toThrow();
  });

  it('rejects invalid dates rather than returning an invalid range', () => {
    expect(() =>
      calculateLastThird({ maghrib: new Date('bad'), nextFajr: new Date('2026-09-09T09:14:00Z') }),
    ).toThrow();
  });
});
