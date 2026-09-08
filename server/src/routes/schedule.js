import { Router } from 'express';
import { createHash } from 'node:crypto';
import { query } from '../database/pool.js';
import {
  toMysqlUtc,
  validateSchedule,
  validateSubscription,
  validateTimezone,
} from '../services/validate.js';

const router = Router();

const hashEndpoint = (endpoint) => createHash('sha256').update(endpoint).digest('hex');

/**
 * The phone uploads its push subscription and the instants it wants notified at.
 * It never uploads coordinates — see server/src/database/migrations.sql.
 * This replaces the whole schedule for that subscription, so Mute all is simply
 * a sync with an empty list.
 */
router.post('/schedule', async (req, res, next) => {
  try {
    const subscription = validateSubscription(req.body?.subscription);
    const timezone = validateTimezone(req.body?.timezone);
    const schedule = validateSchedule(req.body?.schedule ?? []);

    const endpointHash = hashEndpoint(subscription.endpoint);

    await query(
      `INSERT INTO subscriptions (endpoint, endpoint_hash, p256dh, auth, timezone)
            VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
            endpoint = VALUES(endpoint),
            p256dh   = VALUES(p256dh),
            auth     = VALUES(auth),
            timezone = VALUES(timezone)`,
      [subscription.endpoint, endpointHash, subscription.p256dh, subscription.auth, timezone],
    );

    const [row] = await query('SELECT id FROM subscriptions WHERE endpoint_hash = ?', [endpointHash]);
    if (!row) throw new Error('Subscription could not be stored');

    await query('DELETE FROM scheduled_pushes WHERE subscription_id = ? AND sent_at IS NULL', [row.id]);

    for (const entry of schedule) {
      await query(
        `INSERT IGNORE INTO scheduled_pushes (subscription_id, prayer, fire_at)
              VALUES (?, ?, ?)`,
        [row.id, entry.prayer, toMysqlUtc(entry.fireAt)],
      );
    }

    res.json({ ok: true, scheduled: schedule.length });
  } catch (error) {
    next(error);
  }
});

router.post('/unsubscribe', async (req, res, next) => {
  try {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 512) {
      return res.status(400).json({ error: 'endpoint is required' });
    }

    await query('DELETE FROM subscriptions WHERE endpoint_hash = ?', [hashEndpoint(endpoint)]);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export default router;
