import { useCallback, useEffect, useState } from 'react';
import Toggle from './Toggle';
import {
  checkPushAvailability,
  ensurePushSubscription,
  requestNotificationPermission,
  sendTestPush,
  syncSchedule,
  unsubscribePush,
  type PushAvailability,
} from '../notifications/push';
import { buildSchedule, PRAYER_LABELS } from '../notifications/schedule';
import type { PrayerTimesResult } from '../prayer/engine';
import type { LastThirdResult } from '../prayer/tahajjud';
import { formatTime } from '../utils/format';
import {
  allOff,
  allOn,
  anyEnabled,
  countEnabled,
  NOTIFIABLE_PRAYERS,
  togglePrayer,
  type NotifiablePrayer,
  type NotificationPrefs,
  type StoredLocation,
} from '../storage/prefs';

interface Props {
  prefs: NotificationPrefs;
  onChange: (next: NotificationPrefs) => void;
  location: StoredLocation | null;
  timeZone: string;
  times: PrayerTimesResult | null;
  tahajjud: LastThirdResult | null;
}

type Message = { tone: 'good' | 'bad'; text: string } | null;

/**
 * Said before the user taps rather than after. The iOS case in particular is not
 * a failure — it is a step they have not done yet — and finding that out only
 * once a switch springs back is a poor way to learn it.
 */
const BLOCKERS: Partial<Record<PushAvailability, string>> = {
  'requires-home-screen':
    'Add Namaz to your Home Screen first: tap Share, then Add to Home Screen, and open it from there. iPhone only allows notifications for apps installed that way.',
  'no-backend':
    'This build has no notification service configured, so reminders cannot be sent. Everything else works normally.',
  unsupported: 'This device cannot show notifications.',
  'permission-denied':
    'Notifications are blocked for Namaz. Turn them back on in your device settings, then reopen this.',
};

export default function NotificationsPanel({
  prefs, onChange, location, timeZone, times, tahajjud,
}: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<PushAvailability>('available');

  const close = useCallback(() => setOpen(false), []);

  const show = useCallback(() => {
    // Re-checked on open: permission can be granted or revoked in Settings while
    // the app sits in the background.
    setAvailability(checkPushAvailability());
    setMessage(null);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  /**
   * Applies the new preferences immediately (so the switches never lag behind the
   * tap), then asks for permission and syncs. If permission is refused the
   * switches are put back, because leaving them on would be a lie.
   */
  const apply = useCallback(
    async (next: NotificationPrefs) => {
      const previous = prefs;
      onChange(next);
      setMessage(null);

      if (!anyEnabled(next)) {
        setBusy(true);
        try {
          await unsubscribePush();
        } finally {
          setBusy(false);
        }
        return;
      }

      const state = checkPushAvailability();
      setAvailability(state);
      if (state !== 'available') {
        onChange(previous);
        return;
      }

      setBusy(true);
      try {
        const permission = await requestNotificationPermission();
        if (permission !== 'granted') {
          onChange(previous);
          setAvailability(checkPushAvailability());
          setMessage({ tone: 'bad', text: 'Notifications stay off until permission is granted.' });
          return;
        }

        if (!location) {
          onChange(previous);
          setMessage({ tone: 'bad', text: 'Your location is needed before reminders can be scheduled.' });
          return;
        }

        const subscription = await ensurePushSubscription();
        const schedule = buildSchedule({
          latitude: location.latitude,
          longitude: location.longitude,
          timezone: timeZone,
          prefs: next,
        });

        await syncSchedule({
          subscription: subscription.toJSON(),
          timezone: timeZone,
          prefs: next,
          schedule,
        });

        setMessage(null);
      } catch {
        onChange(previous);
        setMessage({ tone: 'bad', text: 'That could not be saved. Check your connection and try again.' });
      } finally {
        setBusy(false);
      }
    },
    [location, onChange, prefs, timeZone],
  );

  const handleToggle = useCallback(
    (prayer: NotifiablePrayer) => void apply(togglePrayer(prefs, prayer)),
    [apply, prefs],
  );

  const handleTest = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await sendTestPush();
      setMessage({ tone: 'good', text: 'Sent. It should appear in a moment.' });
    } catch {
      setMessage({ tone: 'bad', text: 'The test could not be sent. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }, []);

  /** When each reminder would actually arrive, so the choice is concrete. */
  const timeFor = (prayer: NotifiablePrayer): string | null => {
    if (prayer === 'tahajjud') {
      return tahajjud ? formatTime(tahajjud.lastThirdStart, timeZone) : null;
    }
    return times ? formatTime(times[prayer], timeZone) : null;
  };

  const enabled = countEnabled(prefs);
  const blocker = BLOCKERS[availability] ?? null;

  return (
    <>
      <button type="button" className="notify-button" onClick={show} aria-haspopup="dialog">
        <span className="notify-button-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 8-3 8h18s-3-1-3-8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13.7 20a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="notify-button-label">Prayer notifications</span>
        <span className="notify-button-state">
          {enabled === 0 ? 'All muted' : `${enabled} on`}
        </span>
      </button>

      {open && (
        <div className="overlay overlay--bottom" onClick={close}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Prayer notifications"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="sheet-grip" aria-hidden="true" />

            <h2 className="sheet-heading">Prayer notifications</h2>
            <p className="sheet-intro">
              A reminder arrives at each time you switch on. No sound is played.
            </p>

            {blocker && <p className="sheet-blocker">{blocker}</p>}

            <ul className="switches">
              {NOTIFIABLE_PRAYERS.map((prayer) => (
                <li key={prayer} className="switch-row">
                  <Toggle
                    label={PRAYER_LABELS[prayer]}
                    meta={timeFor(prayer)}
                    checked={prefs[prayer]}
                    disabled={busy}
                    onChange={() => handleToggle(prayer)}
                  />
                </li>
              ))}
            </ul>

            <div className="bulk-actions">
              <button type="button" className="button" disabled={busy} onClick={() => void apply(allOff())}>
                Mute all
              </button>
              <button type="button" className="button button--primary" disabled={busy} onClick={() => void apply(allOn())}>
                Enable all
              </button>
            </div>

            {anyEnabled(prefs) && !blocker && (
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => void handleTest()}
              >
                Send a test notification
              </button>
            )}

            {message && (
              <p className={`switch-message switch-message--${message.tone}`} role="status">
                {message.text}
              </p>
            )}

            <button type="button" className="button sheet-close" onClick={close}>Done</button>
          </div>
        </div>
      )}
    </>
  );
}
