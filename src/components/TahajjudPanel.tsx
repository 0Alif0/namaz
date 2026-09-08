import type { LastThirdResult } from '../prayer/tahajjud';
import { formatTimeRange } from '../utils/format';

interface Props {
  tahajjud: LastThirdResult | null;
  timeZone: string;
}

export default function TahajjudPanel({ tahajjud, timeZone }: Props) {
  return (
    <section className="panel" aria-labelledby="tahajjud-heading">
      <h2 className="panel-heading" id="tahajjud-heading">Tahajjud / last third</h2>

      {tahajjud ? (
        <p className="tahajjud-range">
          {formatTimeRange(tahajjud.lastThirdStart, tahajjud.nightEnd, timeZone)}
        </p>
      ) : (
        <p className="panel-empty">Tonight&rsquo;s last third cannot be calculated here.</p>
      )}
    </section>
  );
}
