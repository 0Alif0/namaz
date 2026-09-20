/**
 * Namaz push backend on Cloudflare Workers + D1.
 *
 * Same contract as the Express/MySQL backend in `server/`: the phone uploads a
 * subscription and a list of UTC instants, and a per-minute cron sends whatever
 * has come due. It is a separate deployment target, not a replacement — this one
 * exists because Workers, D1 and Cron Triggers are free for life.
 *
 * Validation is imported from `server/` rather than copied so there is one
 * source of truth, and so `tests/serverValidation.test.ts` covers both backends.
 * Nothing in that module touches Node APIs.
 */

import { buildPushPayload } from '@block65/webcrypto-web-push';
import {
  ValidationError,
  validateSchedule,
  validateSubscription,
  validateTimezone,
} from '../../server/src/services/validate.js';

/** A push later than this is dropped. Fajr at 8am is worse than nothing. */
const STALE_AFTER_MINUTES = 20;

/** Per cron tick. Comfortably above anything one person's phones will produce. */
const DISPATCH_BATCH = 200;

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

async function hashEndpoint(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The notification the phone actually shows. The prayer name is the title so it
 * is the bold line on the lock screen, and its local time follows in the body —
 * the subscription's own timezone, since the instant is stored in UTC.
 */
function notificationFor(prayer, fireAt, timezone) {
  const title = TITLES[prayer] ?? 'Namaz';

  let localTime = null;
  try {
    localTime = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(fireAt));
  } catch {
    // An unrecognised zone should not cost the user the notification.
  }

  const base =
    prayer === 'tahajjud'
      ? 'It has begun, and runs until Fajr'
      : `It is time for ${title}`;

  return {
    title,
    body: localTime ? `${base} · ${localTime}` : `${base}.`,
    tag: `namaz-${prayer}`,
  };
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;

  const allowed = String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return allowed.includes(origin) ? origin : null;
}

function json(body, { status = 200, origin = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function handleSchedule(request, env, origin) {
  const body = await request.json();

  const subscription = validateSubscription(body?.subscription);
  const timezone = validateTimezone(body?.timezone);
  const schedule = validateSchedule(body?.schedule ?? []);
  const endpointHash = await hashEndpoint(subscription.endpoint);

  await env.DB.prepare(
    `INSERT INTO subscriptions (endpoint, endpoint_hash, p256dh, auth, timezone, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint_hash) DO UPDATE SET
          endpoint   = excluded.endpoint,
          p256dh     = excluded.p256dh,
          auth       = excluded.auth,
          timezone   = excluded.timezone,
          updated_at = excluded.updated_at`,
  )
    .bind(
      subscription.endpoint,
      endpointHash,
      subscription.p256dh,
      subscription.auth,
      timezone,
      Date.now(),
    )
    .run();

  const row = await env.DB.prepare('SELECT id FROM subscriptions WHERE endpoint_hash = ?')
    .bind(endpointHash)
    .first();

  if (!row) throw new Error('Subscription could not be stored');

  // Replacing the whole unsent schedule is what makes "Mute all" simply a sync
  // with an empty list.
  const statements = [
    env.DB.prepare('DELETE FROM scheduled_pushes WHERE subscription_id = ? AND sent_at IS NULL').bind(
      row.id,
    ),
  ];

  for (const entry of schedule) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO scheduled_pushes (subscription_id, prayer, fire_at)
              VALUES (?, ?, ?)`,
      ).bind(row.id, entry.prayer, entry.fireAt.getTime()),
    );
  }

  await env.DB.batch(statements);

  return json({ ok: true, scheduled: schedule.length }, { origin });
}

async function handleUnsubscribe(request, env, origin) {
  const body = await request.json();
  const endpoint = body?.endpoint;

  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 512) {
    return json({ error: 'endpoint is required' }, { status: 400, origin });
  }

  await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint_hash = ?')
    .bind(await hashEndpoint(endpoint))
    .run();

  return json({ ok: true }, { origin });
}

function vapidKeys(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw new Error('VAPID keys are not configured. See worker/README.md.');
  }
  return {
    subject: env.VAPID_SUBJECT || 'mailto:admin@localhost',
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
}

async function sendPush(endpoint, keys, notification, env) {
  const payload = await buildPushPayload(
    {
      data: JSON.stringify(notification),
      options: { ttl: STALE_AFTER_MINUTES * 60, urgency: 'high' },
    },
    { endpoint, expirationTime: null, keys },
    vapidKeys(env),
  );

  return fetch(endpoint, payload);
}

/**
 * Sends one notification to an already-registered device, so a deployment can be
 * verified without waiting for the next prayer.
 *
 * It will only push to an endpoint already in the table, which is what stops it
 * being usable as an open relay: the caller has to have subscribed through us
 * first, and the message is fixed.
 */
async function handleTestPush(request, env, origin) {
  const body = await request.json();
  const endpoint = body?.endpoint;

  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 512) {
    return json({ error: 'endpoint is required' }, { status: 400, origin });
  }

  const row = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM subscriptions WHERE endpoint_hash = ?',
  )
    .bind(await hashEndpoint(endpoint))
    .first();

  if (!row) {
    return json({ error: 'this device is not subscribed' }, { status: 404, origin });
  }

  const response = await sendPush(
    row.endpoint,
    { p256dh: row.p256dh, auth: row.auth },
    {
      title: 'Namaz',
      body: 'Notifications are working. You will be reminded at each prayer time.',
      tag: 'namaz-test',
    },
    env,
  );

  if (!response.ok) {
    return json(
      { error: 'the push service rejected it', status: response.status },
      { status: 502, origin },
    );
  }

  return json({ ok: true }, { origin });
}

/**
 * Sends everything due. Counts rather than throws, so one dead subscription
 * cannot block the rest of the batch.
 */
export async function dispatchDuePushes(env, now = new Date()) {
  vapidKeys(env); // fail fast and loudly rather than once per row

  const staleBefore = now.getTime() - STALE_AFTER_MINUTES * 60_000;

  const { results: due } = await env.DB.prepare(
    `SELECT p.id, p.prayer, p.fire_at,
            s.id AS subscription_id, s.endpoint, s.p256dh, s.auth, s.timezone
       FROM scheduled_pushes p
       JOIN subscriptions s ON s.id = p.subscription_id
      WHERE p.sent_at IS NULL
        AND p.fire_at <= ?
      ORDER BY p.fire_at ASC
      LIMIT ?`,
  )
    .bind(now.getTime(), DISPATCH_BATCH)
    .all();

  let sent = 0;
  let stale = 0;
  let removed = 0;
  let failed = 0;

  const done = [];
  const goneSubscriptions = new Set();

  for (const row of due) {
    if (row.fire_at < staleBefore) {
      done.push(row.id);
      stale += 1;
      continue;
    }

    const notification = notificationFor(row.prayer, row.fire_at, row.timezone);

    try {
      const response = await sendPush(
        row.endpoint,
        { p256dh: row.p256dh, auth: row.auth },
        notification,
        env,
      );

      if (response.ok) {
        done.push(row.id);
        sent += 1;
      } else if (response.status === 404 || response.status === 410) {
        // The browser dropped the subscription; its rows go with it.
        goneSubscriptions.add(row.subscription_id);
        removed += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  const statements = [];

  if (done.length > 0) {
    statements.push(
      env.DB.prepare(
        `UPDATE scheduled_pushes SET sent_at = ?
           WHERE id IN (${done.map(() => '?').join(',')})`,
      ).bind(now.getTime(), ...done),
    );
  }

  for (const id of goneSubscriptions) {
    statements.push(env.DB.prepare('DELETE FROM scheduled_pushes WHERE subscription_id = ?').bind(id));
    statements.push(env.DB.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id));
  }

  // Yesterday's sent rows are of no further use.
  statements.push(
    env.DB.prepare('DELETE FROM scheduled_pushes WHERE sent_at IS NOT NULL AND sent_at < ?').bind(
      now.getTime() - 86_400_000,
    ),
  );

  await env.DB.batch(statements);

  return { due: due.length, sent, stale, removed, failed };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: origin
          ? {
              'Access-Control-Allow-Origin': origin,
              'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
              'Access-Control-Max-Age': '86400',
              Vary: 'Origin',
            }
          : {},
      });
    }

    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true }, { origin });
      }

      if (url.pathname === '/api/vapid-public-key') {
        if (!env.VAPID_PUBLIC_KEY) {
          return json({ error: 'not configured' }, { status: 503, origin });
        }
        return json({ publicKey: env.VAPID_PUBLIC_KEY }, { origin });
      }

      if (url.pathname === '/api/schedule' && request.method === 'POST') {
        return await handleSchedule(request, env, origin);
      }

      if (url.pathname === '/api/unsubscribe' && request.method === 'POST') {
        return await handleUnsubscribe(request, env, origin);
      }

      if (url.pathname === '/api/test-push' && request.method === 'POST') {
        return await handleTestPush(request, env, origin);
      }

      // The cron trigger below is what actually delivers. This endpoint exists so
      // a deployment can be verified by hand without waiting for the next minute.
      if (url.pathname === '/api/internal/dispatch' && request.method === 'POST') {
        if (!env.CRON_SECRET || request.headers.get('x-cron-secret') !== env.CRON_SECRET) {
          return json({ error: 'forbidden' }, { status: 403, origin });
        }
        return json(await dispatchDuePushes(env), { origin });
      }

      return json({ error: 'not found' }, { status: 404, origin });
    } catch (error) {
      if (error instanceof ValidationError) {
        return json({ error: error.message }, { status: 400, origin });
      }
      if (error instanceof SyntaxError) {
        return json({ error: 'invalid JSON body' }, { status: 400, origin });
      }

      console.error(error);
      return json({ error: 'internal error' }, { status: 500, origin });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      dispatchDuePushes(env).then(
        (result) => console.log('dispatch', JSON.stringify(result)),
        (error) => console.error('dispatch failed', error),
      ),
    );
  },
};
