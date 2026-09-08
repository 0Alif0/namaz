/**
 * Tahajjud / last third of the night (spec §18, §43).
 *
 * Definition used: the night runs from Maghrib to the *next day's* Fajr, and the
 * last third begins at Maghrib + (2/3 x night).
 *
 * Note for maintainers: the spec's worked example (2:46 AM for New York on
 * 8 September 2026) does not come from this formula — it corresponds to a night
 * measured sunset-to-sunrise, which for that day gives 2:45 AM. Both definitions
 * are in real use. The written rule in §18 is what is implemented here; switching
 * to the sunset/sunrise definition means passing `sunrise` instead of `nextFajr`
 * and nothing else.
 */

export interface LastThirdInput {
  maghrib: Date;
  nextFajr: Date;
}

export interface LastThirdResult {
  nightStart: Date;
  nightEnd: Date;
  lastThirdStart: Date;
  /** Night length in milliseconds. */
  nightDurationMs: number;
}

export function calculateLastThird({ maghrib, nextFajr }: LastThirdInput): LastThirdResult {
  const start = maghrib.getTime();
  const end = nextFajr.getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('calculateLastThird requires two valid dates');
  }
  if (end <= start) {
    throw new Error('calculateLastThird requires nextFajr to be after maghrib');
  }

  const duration = end - start;

  return {
    nightStart: new Date(start),
    nightEnd: new Date(end),
    lastThirdStart: new Date(start + (duration * 2) / 3),
    nightDurationMs: duration,
  };
}
