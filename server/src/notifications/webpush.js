/**
 * Web Push delivery (spec §26).
 *
 * The cron job calls dispatchDuePushes() once a minute. It sends every push whose
 * moment has arrived, skips ones that are already stale, and deletes
 * subscriptions the push service reports as gone.
 */

import webpush from 'web-push';
import { query } from '../database/pool.js';
import { toMysqlUtc } from '../services/validate.js';

/**
 * A push more than this many minutes late is dropped rather than sent. Telling
 * someone it is time for Fajr at 8am is worse than saying nothing.
 */
export const STALE_AFTER_MINUTES = 20;

/**
 * Tahajjud is the prayer; the last third is the interval. The notification names
 * the interval, because that is what has just begun.
 */
const TITLES = {
  fajr: 'Fajr',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
  tahajjud: 'Last third of the night',
};

const BODIES = {
  fajr: 'It is time for Fajr.',
  dhuhr: 'It is time for Dhuhr.',
  asr: 'It is time for Asr.',
  maghrib: 'It is time for Maghrib.',
  isha: 'It is time for Isha.',
  tahajjud: 'It has begun, and runs until Fajr.',
};

let configured = false;

export function configureWebPush() {
  if (configured) return;

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error('VAPID keys are not configured. Run `npm run vapid`.');
  }

  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@localhost', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
}

function buildPayload(prayer) {
  return JSON.stringify({
    title: TITLES[prayer] ?? 'Namaz',
    body: BODIES[prayer] ?? 'It is time for prayer.',
    tag: `namaz-${prayer}`,
  });
}

async function deleteSubscription(subscriptionId) {
  await query('DELETE FROM subscriptions WHERE id = ?', [subscriptionId]);
}

/**
 * Sends everything due. Returns counts rather than throwing on individual
 * failures, so one dead subscription cannot block the rest of the batch.
 */
export async function dispatchDuePushes(now = new Date()) {
  configureWebPush();

  const staleBefore = new Date(now.getTime() - STALE_AFTER_MINUTES * 60_000);

  const due = await query(
    `SELECT p.id, p.prayer, p.fire_at,
            s.id AS subscription_id, s.endpoint, s.p256dh, s.auth
       FROM scheduled_pushes p
       JOIN subscriptions s ON s.id = p.subscription_id
      WHERE p.sent_at IS NULL
        AND p.fire_at <= ?
      ORDER BY p.fire_at ASC
      LIMIT 500`,
    [toMysqlUtc(now)],
  );

  let sent = 0;
  let stale = 0;
  let removed = 0;
  let failed = 0;

  for (const row of due) {
    const fireAt = row.fire_at instanceof Date ? row.fire_at : new Date(row.fire_at);

    if (fireAt < staleBefore) {
      await query('UPDATE scheduled_pushes SET sent_at = ? WHERE id = ?', [toMysqlUtc(now), row.id]);
      stale += 1;
      continue;
    }

    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        buildPayload(row.prayer),
        { TTL: STALE_AFTER_MINUTES * 60, urgency: 'high' },
      );

      await query('UPDATE scheduled_pushes SET sent_at = ? WHERE id = ?', [toMysqlUtc(now), row.id]);
      sent += 1;
    } catch (error) {
      const status = error?.statusCode;

      if (status === 404 || status === 410) {
        // The browser dropped the subscription. Cascade removes its rows.
        await deleteSubscription(row.subscription_id);
        removed += 1;
      } else {
        failed += 1;
      }
    }
  }

  // Housekeeping: yesterday's sent rows are of no further use.
  await query('DELETE FROM scheduled_pushes WHERE sent_at IS NOT NULL AND sent_at < ?', [
    toMysqlUtc(new Date(now.getTime() - 86_400_000)),
  ]);

  return { due: due.length, sent, stale, removed, failed };
}
