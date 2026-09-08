import { PRAYER_ORDER, type PrayerName, type PrayerTimesResult } from '../prayer/engine';
import { formatTime } from '../utils/format';

const LABELS: Record<PrayerName, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

interface Props {
  times: PrayerTimesResult;
  timeZone: string;
  now: Date;
}

/** The prayer whose window we are currently in, so "now" is not shown by colour alone. */
function currentPrayer(times: PrayerTimesResult, now: Date): PrayerName | null {
  const elapsed = PRAYER_ORDER.filter((name) => times[name].getTime() <= now.getTime());
  return elapsed.length > 0 ? (elapsed[elapsed.length - 1] as PrayerName) : null;
}

export default function PrayerTimesPanel({ times, timeZone, now }: Props) {
  const active = currentPrayer(times, now);

  return (
    <section className="panel" aria-labelledby="prayer-times-heading">
      <h2 className="panel-heading" id="prayer-times-heading">Today&rsquo;s prayer times</h2>

      <ul className="times">
        {PRAYER_ORDER.map((name) => {
          const isNow = name === active;
          return (
            <li key={name} className={isNow ? 'time-row time-row--now' : 'time-row'}>
              <span className="time-name">
                {LABELS[name]}
                {isNow && <span className="time-now"> now</span>}
              </span>
              <span className="time-value">{formatTime(times[name], timeZone)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
