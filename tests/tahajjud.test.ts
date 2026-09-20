import { describe, expect, it } from 'vitest';
import { activeLastThird, calculateLastThird } from '../src/prayer/tahajjud';
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

describe('which night is in force (spec §18)', () => {
  const sep7 = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 9, day: 7 } });
  const sep8 = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 9, day: 8 } });
  const sep9 = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 9, day: 9 } });

  // The night the user is inside during the early hours of 8 September.
  const inProgress = calculateLastThird({ maghrib: sep7.maghrib, nextFajr: sep8.fajr });
  // The night that begins on the evening of 8 September.
  const upcoming = calculateLastThird({ maghrib: sep8.maghrib, nextFajr: sep9.fajr });

  const at = (hour: number, minute = 0) =>
    new Date(Date.parse(`2026-09-08T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-04:00`));

  const pick = (now: Date) =>
    activeLastThird({ now, todayFajr: sep8.fajr, inProgress, upcoming });

  it('shows the night still running when woken during it', () => {
    // 2 AM: inside the last third that began at the previous evening's Maghrib.
    expect(pick(at(2))?.nightEnd.getTime()).toBe(sep8.fajr.getTime());
    expect(pick(at(2))?.nightStart.getTime()).toBe(sep7.maghrib.getTime());

    // Previous Maghrib (7:18 PM calculated) -> Fajr 5:12 AM gives 1:54 AM to
    // 5:12 AM. That is the window a user awake at 2 AM on 8 September is inside;
    // pairing *today's* Maghrib with tomorrow's Fajr ends at 5:14 AM, a day off.
    const shown = pick(at(2))!;
    expect(formatTimeRange(shown.lastThirdStart, shown.nightEnd, TZ)).toBe('1:54 AM – 5:12 AM');
  });

  it('never shows a window that ended before now, nor one a day away', () => {
    const shown = pick(at(2))!;
    const twoAm = at(2).getTime();

    expect(shown.nightEnd.getTime()).toBeGreaterThan(twoAm);
    // The end is within hours, not the ~27 hours the coming night would give.
    expect((shown.nightEnd.getTime() - twoAm) / 3_600_000).toBeLessThan(6);
  });

  it('switches to the coming night once Fajr has passed', () => {
    expect(pick(at(6))?.nightStart.getTime()).toBe(sep8.maghrib.getTime());
    expect(pick(at(14))?.nightStart.getTime()).toBe(sep8.maghrib.getTime());
    // After Maghrib the night has begun and its last third is still ahead.
    expect(pick(at(21))?.nightStart.getTime()).toBe(sep8.maghrib.getTime());
  });

  it('ends exactly at Fajr, never after it', () => {
    for (const hour of [0, 2, 4, 6, 12, 20, 23]) {
      const shown = pick(at(hour))!;
      expect(shown.nightEnd.getTime()).toBeLessThanOrEqual(
        Math.max(sep8.fajr.getTime(), sep9.fajr.getTime()),
      );
      expect(shown.lastThirdStart.getTime()).toBeLessThan(shown.nightEnd.getTime());
    }
  });

  it('says nothing rather than substituting the wrong night', () => {
    expect(activeLastThird({ now: at(2), todayFajr: sep8.fajr, inProgress: null, upcoming })).toBeNull();
    expect(activeLastThird({ now: at(14), todayFajr: sep8.fajr, inProgress, upcoming: null })).toBeNull();
  });
});

describe('the window closes before Fajr, not at it', () => {
  const sep7 = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 9, day: 7 } });
  const sep8 = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 9, day: 8 } });

  it('ends two minutes before Fajr', () => {
    const result = calculateLastThird({ maghrib: sep7.maghrib, nextFajr: sep8.fajr });

    expect(sep8.fajr.getTime() - result.lastThirdEnd.getTime()).toBe(120_000);
    expect(result.lastThirdEnd.getTime()).toBeLessThan(sep8.fajr.getTime());
    // The split itself is still measured to Fajr.
    expect(result.nightEnd.getTime()).toBe(sep8.fajr.getTime());
  });

  it('reads 1:54 AM to 5:10 AM for New York on 8 September 2026', () => {
    const result = calculateLastThird({ maghrib: sep7.maghrib, nextFajr: sep8.fajr });

    expect(formatTime(sep8.fajr, TZ)).toBe('5:12 AM');
    expect(formatTimeRange(result.lastThirdStart, result.lastThirdEnd, TZ)).toBe('1:54 AM – 5:10 AM');
  });

  it('never closes before it opens, even on an absurdly short night', () => {
    const maghrib = new Date('2026-06-21T22:00:00Z');
    const result = calculateLastThird({ maghrib, nextFajr: new Date(maghrib.getTime() + 30_000) });

    expect(result.lastThirdEnd.getTime()).toBeGreaterThanOrEqual(result.lastThirdStart.getTime());
  });

  it('holds the rule across a year of real nights', () => {
    for (let day = 1; day <= 365; day += 7) {
      const date = new Date(Date.UTC(2026, 0, day));
      const civil = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
      const today = calculatePrayerTimesForCivilDate({ ...NY, civil });
      const tomorrow = calculatePrayerTimesForCivilDate({ ...NY, civil: { ...civil, day: civil.day + 1 } });

      const result = calculateLastThird({ maghrib: today.maghrib, nextFajr: tomorrow.fajr });

      expect(result.lastThirdStart.getTime()).toBeGreaterThan(today.maghrib.getTime());
      expect(result.lastThirdEnd.getTime()).toBeLessThan(tomorrow.fajr.getTime());
      expect(result.lastThirdEnd.getTime()).toBeGreaterThan(result.lastThirdStart.getTime());
    }
  });
});
