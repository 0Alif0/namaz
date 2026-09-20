import { describe, expect, it } from 'vitest';
import { calculatePrayerTimesForCivilDate, type PrayerTimesResult } from '../src/prayer/engine';
import { currentPrayer, findNextPrayer, highlightedPrayer, windowProgress } from '../src/prayer/next';
import { formatCountdown } from '../src/utils/format';

const NY = { latitude: 40.64, longitude: -73.98 };

const today = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 9, day: 8 } });
const tomorrow = calculatePrayerTimesForCivilDate({ ...NY, civil: { year: 2026, month: 9, day: 9 } });

/** A moment `minutes` after the given prayer. */
const after = (times: PrayerTimesResult, name: keyof PrayerTimesResult, minutes: number) =>
  new Date(times[name].getTime() + minutes * 60_000);

describe('current prayer window', () => {
  it('names the prayer whose window is open', () => {
    expect(currentPrayer(today, after(today, 'dhuhr', 30))).toBe('dhuhr');
    expect(currentPrayer(today, after(today, 'asr', 1))).toBe('asr');
    expect(currentPrayer(today, after(today, 'isha', 90))).toBe('isha');
  });

  it('opens no window between sunrise and Dhuhr, because sunrise ends Fajr', () => {
    expect(currentPrayer(today, after(today, 'fajr', 10))).toBe('fajr');
    expect(currentPrayer(today, after(today, 'sunrise', 1))).toBeNull();
    expect(currentPrayer(today, after(today, 'sunrise', 120))).toBeNull();
  });

  it('belongs to Isha before Fajr, since that window opened last night', () => {
    // 30 minutes before Fajr, and again in the small hours: still Isha's window,
    // even though today's Isha time is hours ahead on the clock.
    expect(currentPrayer(today, after(today, 'fajr', -30))).toBe('isha');
    expect(currentPrayer(today, after(today, 'fajr', -240))).toBe('isha');
  });
});

describe('next prayer', () => {
  it('finds the next prayer still to come today', () => {
    const next = findNextPrayer(today, tomorrow.fajr, after(today, 'dhuhr', 5));
    expect(next?.name).toBe('asr');
    expect(next?.tomorrow).toBe(false);
    expect(next?.at.getTime()).toBe(today.asr.getTime());
  });

  it('counts sunrise as the next event while Fajr is open', () => {
    const next = findNextPrayer(today, tomorrow.fajr, after(today, 'fajr', 5));
    expect(next?.name).toBe('sunrise');
  });

  it('rolls over to tomorrow’s Fajr after Isha', () => {
    const next = findNextPrayer(today, tomorrow.fajr, after(today, 'isha', 60));
    expect(next?.name).toBe('fajr');
    expect(next?.tomorrow).toBe(true);
    expect(next?.at.getTime()).toBe(tomorrow.fajr.getTime());
  });

  it('returns nothing rather than a wrong time when tomorrow cannot be calculated', () => {
    expect(findNextPrayer(today, null, after(today, 'isha', 60))).toBeNull();
  });
});

describe('progress through the gap', () => {
  it('runs from 0 at the last event to 1 at the next', () => {
    const start = today.dhuhr;
    const end = today.asr;
    const next = { name: 'asr' as const, at: end, tomorrow: false };
    const midpoint = new Date((start.getTime() + end.getTime()) / 2);

    expect(windowProgress(today, next, start)).toBeCloseTo(0, 5);
    expect(windowProgress(today, next, midpoint)).toBeCloseTo(0.5, 2);

    // Just before, not exactly at: the instant Asr arrives it becomes the last
    // elapsed event and the app is already counting down to Maghrib, so
    // (next: asr, now: asr) is a pair that never actually occurs.
    expect(windowProgress(today, next, new Date(end.getTime() - 1000))).toBeCloseTo(1, 3);
  });

  it('is measured from sunrise in the gap before Dhuhr, where no window is open', () => {
    const next = { name: 'dhuhr' as const, at: today.dhuhr, tomorrow: false };
    const justAfterSunrise = after(today, 'sunrise', 1);

    expect(currentPrayer(today, justAfterSunrise)).toBeNull();
    expect(windowProgress(today, next, justAfterSunrise)).toBeGreaterThan(0);
  });

  it('has nothing to measure before the first event of the day', () => {
    const next = { name: 'fajr' as const, at: today.fajr, tomorrow: false };
    expect(windowProgress(today, next, after(today, 'fajr', -30))).toBeNull();
  });
});

describe('countdown wording', () => {
  it('writes the remaining time out in full', () => {
    expect(formatCountdown(30_000)).toBe('in 30 seconds');
    expect(formatCountdown(60_000)).toBe('in 1 minute');
    expect(formatCountdown(42 * 60_000)).toBe('in 42 minutes');
    expect(formatCountdown(60 * 60_000)).toBe('in 1 hour');
    expect(formatCountdown(72 * 60_000)).toBe('in 1 hour 12 minutes');
    expect(formatCountdown(3 * 3_600_000)).toBe('in 3 hours');
  });

  it('never counts below zero', () => {
    expect(formatCountdown(-5_000)).toBe('in 0 seconds');
  });
});

describe('highlighted row', () => {
  it('marks the open window as "now"', () => {
    expect(highlightedPrayer(today, 'asr', after(today, 'dhuhr', 30))).toEqual({
      name: 'dhuhr', kind: 'now',
    });
    expect(highlightedPrayer(today, null, after(today, 'isha', 90))).toEqual({
      name: 'isha', kind: 'now',
    });
  });

  it('marks only the open window, never the next prayer as well', () => {
    // The next prayer already carries a countdown; a second mark would put two
    // anchors on one short list.
    const mark = highlightedPrayer(today, 'asr', after(today, 'dhuhr', 30));
    expect(mark?.name).not.toBe('asr');
  });

  it('marks the prayer being waited on between sunrise and Dhuhr', () => {
    // The gap runs several hours. It used to leave the list with nothing
    // marked at all, which is the whole reason this exists.
    for (const minutes of [1, 60, 180, 300]) {
      const at = after(today, 'sunrise', minutes);
      expect(currentPrayer(today, at)).toBeNull();
      expect(highlightedPrayer(today, 'dhuhr', at)).toEqual({ name: 'dhuhr', kind: 'next' });
    }
  });

  it('never calls the waited-on prayer "now", since none is due', () => {
    expect(highlightedPrayer(today, 'dhuhr', after(today, 'sunrise', 30))?.kind).toBe('next');
  });

  it('leaves the list unmarked rather than guessing when there is no next', () => {
    expect(highlightedPrayer(today, null, after(today, 'sunrise', 30))).toBeNull();
  });

  it('keeps some row marked at every minute of the day', () => {
    const start = today.fajr.getTime();
    for (let m = 0; m < 24 * 60; m++) {
      const at = new Date(start + m * 60_000);
      const next = findNextPrayer(today, tomorrow.fajr, at);
      const mark = highlightedPrayer(today, next && !next.tomorrow ? next.name : null, at);
      expect(mark, `unmarked at +${m} min from Fajr`).not.toBeNull();
    }
  });
});
