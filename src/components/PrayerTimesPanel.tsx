import { PRAYER_ORDER, type PrayerName, type PrayerTimesResult } from '../prayer/engine';
import { highlightedPrayer } from '../prayer/next';
import type { LastThirdResult } from '../prayer/tahajjud';
import { formatCountdown, formatTime, formatTimeRange } from '../utils/format';

const LABELS: Record<PrayerName, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

/** Sunrise is the end of Fajr, not a prayer, so it is set a step back. */
const MINOR: PrayerName[] = ['sunrise'];

interface Props {
  times: PrayerTimesResult;
  tahajjud: LastThirdResult | null;
  timeZone: string;
  now: Date;
  nextName: PrayerName | null;
  nextAt: Date | null;
  /** How far through the open window we are, 0–1, or null when none is open. */
  progress: number | null;
}

export default function PrayerTimesPanel({
  times, tahajjud, timeZone, now, nextName, nextAt, progress,
}: Props) {
  const highlight = highlightedPrayer(times, nextName, now);

  const inLastThird =
    tahajjud !== null &&
    now.getTime() >= tahajjud.lastThirdStart.getTime() &&
    now.getTime() <= tahajjud.lastThirdEnd.getTime();

  return (
    <section className="panel" aria-labelledby="prayer-times-heading">
      <h2 className="panel-heading" id="prayer-times-heading">Today</h2>

      <ul className="times">
        {PRAYER_ORDER.map((name) => {
          const marked = highlight !== null && highlight.name === name;
          const isNow = marked && highlight.kind === 'now';
          const isNext = name === nextName;

          const classes = ['time-row'];
          if (marked) classes.push(isNow ? 'time-row--now' : 'time-row--next');
          // A highlighted sunrise is still the minor row it always was; the
          // step-back is dropped only so the mark is not fighting grey type.
          if (MINOR.includes(name) && !marked) classes.push('time-row--minor');

          return (
            <li key={name} className={classes.join(' ')}>
              <span className="time-name">
                {LABELS[name]}
                {marked && (
                  <span className={isNow ? 'time-tag' : 'time-tag time-tag--next'}>
                    {isNow ? 'now' : 'next'}
                  </span>
                )}
              </span>

              <span className="time-right">
                <span className="time-value">{formatTime(times[name], timeZone)}</span>
                {isNext && nextAt && !isNow && (
                  <span className="time-until">{formatCountdown(nextAt.getTime() - now.getTime())}</span>
                )}
              </span>

              {/*
                The hairline measures elapsed time since the last event, so it
                reads the same either way: how far through an open window we
                are, or how far through the wait for the prayer being marked.
              */}
              {marked && progress !== null && (
                <span className={isNow ? 'time-progress' : 'time-progress time-progress--soft'} aria-hidden="true">
                  <span style={{ transform: `scaleX(${progress})` }} />
                </span>
              )}
            </li>
          );
        })}

        {/*
          Sequentially after Isha, because that is where it falls in the night —
          not in a section of its own. It is an interval rather than a moment, so
          it carries a range.

          Isha's window and the last third both run "now" for most of the night,
          so an identical solid highlight on both reads as a confusing repeat.
          This gets a lighter, distinct treatment (tint + accent edge, not a
          filled block) and its own word — "open" rather than "now" — since it
          is a voluntary window standing open, not a prayer falling due.
        */}
        <li className={inLastThird ? 'time-row time-row--active' : 'time-row'}>
          <span className="time-name">
            Tahajjud
            {inLastThird && <span className="time-tag time-tag--open">open</span>}
            <span className="time-qualifier">last third</span>
          </span>

          <span className="time-right">
            {tahajjud ? (
              <span className="time-value time-value--range">
                {formatTimeRange(tahajjud.lastThirdStart, tahajjud.lastThirdEnd, timeZone)}
              </span>
            ) : (
              <span className="time-value time-value--range time-unavailable">unavailable here</span>
            )}
          </span>
        </li>
      </ul>
    </section>
  );
}
