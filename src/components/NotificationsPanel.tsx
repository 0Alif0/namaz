import { useCallback, useState } from 'react';
import Toggle from './Toggle';
import {
  checkPushAvailability,
  ensurePushSubscription,
  requestNotificationPermission,
  syncSchedule,
  unsubscribePush,
} from '../notifications/push';
import { buildSchedule, PRAYER_LABELS } from '../notifications/schedule';
import {
  allOff,
  allOn,
  anyEnabled,
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
}

export default function NotificationsPanel({ prefs, onChange, location, timeZone }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

      const availability = checkPushAvailability();
      if (availability === 'requires-home-screen') {
        onChange(previous);
        setMessage('To get prayer notifications on iPhone, add Namaz to your Home Screen: tap Share, then Add to Home Screen.');
        return;
      }
      if (availability === 'no-backend') {
        onChange(previous);
        setMessage('Prayer notifications are not available in this version of the app. Everything else on this screen works as normal.');
        return;
      }
      if (availability === 'unsupported') {
        onChange(previous);
        setMessage('Notifications are not available on this device.');
        return;
      }
      if (availability === 'permission-denied') {
        onChange(previous);
        setMessage('Notifications are blocked for Namaz. Turn them on in your device settings to use this.');
        return;
      }

      setBusy(true);
      try {
        const permission = await requestNotificationPermission();
        if (permission !== 'granted') {
          onChange(previous);
          setMessage('Notifications are off because permission was not granted.');
          return;
        }

        if (!location) {
          onChange(previous);
          setMessage('Prayer notifications need your location first.');
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
        setMessage('Your notifications could not be saved. Check your connection and try again.');
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

  return (
    <section className="panel" aria-labelledby="notifications-heading">
      <h2 className="panel-heading" id="notifications-heading">Prayer notifications</h2>

      <ul className="switches">
        {NOTIFIABLE_PRAYERS.map((prayer) => (
          <li key={prayer} className="switch-row">
            <Toggle
              label={PRAYER_LABELS[prayer]}
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

      {message && <p className="switch-message" role="status">{message}</p>}
    </section>
  );
}
