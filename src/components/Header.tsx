import type { HijriDate, HijriDayOffset } from '../calendar/hijri';
import type { SpecialDay } from '../calendar/specialDays';
import { specialDayNote } from '../calendar/specialDays';
import { formatGregorianDate } from '../utils/format';

interface Props {
  now: Date;
  timeZone: string;
  hijri: HijriDate;
  specialDay: SpecialDay | null;
  placeName: string | null;
  hijriOffset: HijriDayOffset;
  onHijriOffsetChange: (offset: HijriDayOffset) => void;
}

const NEXT_OFFSET: Record<HijriDayOffset, HijriDayOffset> = { [-1]: 0, 0: 1, 1: -1 };

export default function Header({
  now, timeZone, hijri, specialDay, placeName, hijriOffset, onHijriOffsetChange,
}: Props) {
  const note = specialDay ? specialDayNote(specialDay) : null;

  return (
    <header className="masthead">
      <h1 className="wordmark">Namaz</h1>

      <p className="gregorian">{formatGregorianDate(now, timeZone)}</p>

      <button
        type="button"
        className="hijri"
        onClick={() => onHijriOffsetChange(NEXT_OFFSET[hijriOffset])}
        aria-label={`Islamic date: ${hijri.formatted}. Adjust by one day to match your local moon sighting.`}
      >
        {hijri.formatted}
        {hijriOffset !== 0 && (
          <span className="hijri-adjust">{hijriOffset > 0 ? '+1 day' : '\u22121 day'}</span>
        )}
      </button>

      {specialDay && (
        <p className="occasion">
          <span className="occasion-name">{specialDay.name}</span>
          {note && <span className="occasion-note">{note}</span>}
        </p>
      )}

      {placeName && <p className="place">{placeName}</p>}
    </header>
  );
}
