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

/**
 * The window closes two minutes before Fajr rather than at it. Fajr ending the
 * night is what defines the third; it is not a moment you are still free to be
 * praying Tahajjud in. Two minutes rather than one so the gap survives rounding
 * to whole displayed minutes and still reads as a gap on the clock.
 */
export const CLOSES_BEFORE_FAJR_MS = 120_000;

export interface LastThirdResult {
  nightStart: Date;
  /** Fajr: the boundary the two-thirds split is measured to. */
  nightEnd: Date;
  lastThirdStart: Date;
  /** The last minute you can be praying: Fajr minus two minutes. */
  lastThirdEnd: Date;
  /** Night length in milliseconds. */
  nightDurationMs: number;
}

/**
 * Which night's last third applies right now.
 *
 * Before Fajr the night in progress began at *yesterday's* Maghrib, so that is
 * the window the user is actually inside — showing the coming night instead puts
 * an end time roughly a day away behind a clock reading that looks almost
 * identical. From Fajr onwards the relevant night is the one about to begin,
 * today's Maghrib through tomorrow's Fajr.
 *
 * Returns null rather than substituting the other night when the one that
 * applies cannot be calculated, since a plausible wrong night is worse than
 * saying nothing.
 */
export function activeLastThird(input: {
  now: Date;
  todayFajr: Date;
  inProgress: LastThirdResult | null;
  upcoming: LastThirdResult | null;
}): LastThirdResult | null {
  const { now, todayFajr, inProgress, upcoming } = input;
  return now.getTime() < todayFajr.getTime() ? inProgress : upcoming;
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
  const lastThirdStart = start + (duration * 2) / 3;

  return {
    nightStart: new Date(start),
    nightEnd: new Date(end),
    lastThirdStart: new Date(lastThirdStart),
    // Clamped so a pathologically short night can never produce a window that
    // closes before it opens.
    lastThirdEnd: new Date(Math.max(lastThirdStart, end - CLOSES_BEFORE_FAJR_MS)),
    nightDurationMs: duration,
  };
}
