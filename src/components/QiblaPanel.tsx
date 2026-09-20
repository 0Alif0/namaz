import { useCallback, useEffect, useState } from 'react';
import {
  angularSeparation,
  compassIsSupported,
  isAlignedWithQibla,
  qiblaNeedleRotation,
  requestCompassPermission,
  watchCompass,
  type CompassReading,
  type CompassStatus,
} from '../qibla/compass';
import { compassPointName } from '../qibla/bearing';
import { formatBearing } from '../utils/format';

interface Props {
  bearing: number | null;
}

function Dial({ rotation, aligned }: { rotation: number; aligned: boolean }) {
  return (
    <svg className="dial" viewBox="0 0 120 120" role="presentation" focusable="false">
      <circle cx="60" cy="60" r="52" className="dial-ring" />
      <circle cx="60" cy="60" r="3" className="dial-hub" />
      {[0, 90, 180, 270].map((angle) => (
        <line
          key={angle}
          x1="60" y1="12" x2="60" y2="20"
          className="dial-tick"
          transform={`rotate(${angle} 60 60)`}
        />
      ))}
      <g transform={`rotate(${rotation} 60 60)`} className={aligned ? 'needle needle--aligned' : 'needle'}>
        <path d="M60 16 L67 62 L60 56 L53 62 Z" />
      </g>
    </svg>
  );
}

export default function QiblaPanel({ bearing }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CompassStatus>('idle');
  const [reading, setReading] = useState<CompassReading | null>(null);

  useEffect(() => {
    if (!open || status !== 'active') return undefined;

    const stop = watchCompass((next) => {
      setReading(next);
      if (!next) setStatus('no-heading');
    });
    return stop;
  }, [open, status]);

  const openCompass = useCallback(async () => {
    setOpen(true);

    if (!compassIsSupported()) {
      setStatus('unsupported');
      return;
    }

    const result = await requestCompassPermission();
    setStatus(result === 'denied' ? 'permission-denied' : 'active');
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setStatus('idle');
    setReading(null);
  }, []);

  if (bearing === null) {
    return (
      <section className="panel" aria-labelledby="qibla-heading">
        <h2 className="panel-heading" id="qibla-heading">Qibla</h2>
        <p className="panel-empty">You are at the Kaaba, so there is no direction to face.</p>
      </section>
    );
  }

  const heading = reading?.heading ?? null;
  const rotation = heading === null ? bearing : qiblaNeedleRotation(bearing, heading);
  const aligned = heading !== null && isAlignedWithQibla(bearing, heading);

  const unavailable =
    status === 'unsupported' || status === 'permission-denied' || status === 'no-heading';

  return (
    <section className="panel" aria-labelledby="qibla-heading">
      <h2 className="panel-heading" id="qibla-heading">Qibla</h2>

      <button type="button" className="qibla-summary" onClick={openCompass}>
        <Dial rotation={bearing} aligned={false} />
        <span className="qibla-text">
          <span className="qibla-bearing">{formatBearing(bearing)}</span>
          <span className="qibla-hint">{compassPointName(bearing)} of true north</span>
          <span className="qibla-hint qibla-hint--action">Tap for compass</span>
        </span>
      </button>

      {open && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Qibla compass">
          <div className="overlay-card">
            <Dial rotation={rotation} aligned={aligned} />

            <p className="overlay-bearing">{formatBearing(bearing)} from true north</p>

            {status === 'active' && heading !== null && (
              <p className={aligned ? 'overlay-status overlay-status--aligned' : 'overlay-status'}>
                {aligned
                  ? 'Facing the Qibla.'
                  : `Turn ${angularSeparation(bearing, heading) < 1 ? 'slightly' : `${Math.round(angularSeparation(bearing, heading))}\u00B0`} to line up.`}
              </p>
            )}

            {status === 'active' && heading !== null && !reading?.isTrueHeading && (
              <p className="overlay-note">
                Using the magnetic compass. It can be a few degrees off true north.
              </p>
            )}

            {status === 'active' && heading === null && (
              <p className="overlay-status">Move your phone in a figure of eight to calibrate.</p>
            )}

            {unavailable && (
              <p className="overlay-status">
                Compass unavailable. Qibla is {formatBearing(bearing)} from true north.
              </p>
            )}

            <button type="button" className="button" onClick={close}>Close</button>
          </div>
        </div>
      )}
    </section>
  );
}
