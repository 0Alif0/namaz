/**
 * Input validation (spec §39).
 *
 * Everything arriving from the browser is treated as hostile. Nothing reaches a
 * SQL statement without passing through here, and every statement uses bound
 * parameters regardless.
 */

export const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'tahajjud'];

/** A week of six prayers is 42; allow some slack, then stop. */
export const MAX_SCHEDULE_ENTRIES = 100;

/** How far ahead a client may schedule. Anything beyond this is rejected. */
export const MAX_HORIZON_DAYS = 14;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

function requireString(value, field, maxLength) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${field} is required`);
  }
  if (value.length > maxLength) {
    throw new ValidationError(`${field} is too long`);
  }
  return value;
}

export function validateSubscription(input) {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('subscription is required');
  }

  const endpoint = requireString(input.endpoint, 'subscription.endpoint', 512);

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ValidationError('subscription.endpoint is not a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw new ValidationError('subscription.endpoint must use https');
  }

  const keys = input.keys;
  if (!keys || typeof keys !== 'object') {
    throw new ValidationError('subscription.keys is required');
  }

  return {
    endpoint,
    p256dh: requireString(keys.p256dh, 'subscription.keys.p256dh', 255),
    auth: requireString(keys.auth, 'subscription.keys.auth', 255),
  };
}

export function validateTimezone(value) {
  const timezone = typeof value === 'string' && value ? value : 'UTC';
  if (timezone.length > 64) throw new ValidationError('timezone is too long');

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new ValidationError('timezone is not a recognised IANA zone');
  }
  return timezone;
}

/**
 * Accepts [{prayer, fireAt}] and returns [{prayer, fireAt: Date}], sorted,
 * de-duplicated, with past and far-future entries dropped.
 */
export function validateSchedule(input, now = new Date()) {
  if (!Array.isArray(input)) {
    throw new ValidationError('schedule must be an array');
  }
  if (input.length > MAX_SCHEDULE_ENTRIES) {
    throw new ValidationError(`schedule may not exceed ${MAX_SCHEDULE_ENTRIES} entries`);
  }

  const horizon = now.getTime() + MAX_HORIZON_DAYS * 86_400_000;
  const seen = new Set();
  const entries = [];

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') {
      throw new ValidationError('schedule entries must be objects');
    }
    if (!PRAYERS.includes(raw.prayer)) {
      throw new ValidationError(`unknown prayer: ${String(raw.prayer)}`);
    }

    const timestamp = Date.parse(raw.fireAt);
    if (!Number.isFinite(timestamp)) {
      throw new ValidationError('schedule entries need a valid ISO fireAt');
    }

    // Silently drop rather than reject: a schedule built a moment ago can have
    // an entry that just passed, and that is not the client's fault.
    if (timestamp <= now.getTime() || timestamp > horizon) continue;

    const key = `${raw.prayer}@${timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({ prayer: raw.prayer, fireAt: new Date(timestamp) });
  }

  entries.sort((a, b) => a.fireAt - b.fireAt);
  return entries;
}

/** Rejects anything that is not a plain rounded coordinate pair. */
export function validateCoarseCoordinates(latRaw, lonRaw) {
  const latitude = Number(latRaw);
  const longitude = Number(lonRaw);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new ValidationError('lat is out of range');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new ValidationError('lon is out of range');
  }

  // Round again server-side so a client cannot store a precise position.
  return {
    latitude: Number(latitude.toFixed(2)),
    longitude: Number(longitude.toFixed(2)),
  };
}

export function coarseKey(latitude, longitude) {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

/** Converts a Date to the 'YYYY-MM-DD HH:MM:SS' UTC form MySQL DATETIME expects. */
export function toMysqlUtc(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
