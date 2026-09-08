import { describe, expect, it } from 'vitest';
import {
  coarseKey,
  MAX_SCHEDULE_ENTRIES,
  toMysqlUtc,
  validateCoarseCoordinates,
  validateSchedule,
  validateSubscription,
  validateTimezone,
  ValidationError,
} from '../server/src/services/validate.js';

const now = new Date('2026-09-08T12:00:00Z');
const inHours = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();

const goodSubscription = {
  endpoint: 'https://web.push.apple.com/abc123',
  keys: { p256dh: 'BPublicKeyValue', auth: 'AuthSecretValue' },
};

describe('subscription validation (spec §39)', () => {
  it('accepts a well-formed subscription', () => {
    expect(validateSubscription(goodSubscription)).toEqual({
      endpoint: 'https://web.push.apple.com/abc123',
      p256dh: 'BPublicKeyValue',
      auth: 'AuthSecretValue',
    });
  });

  it('rejects a missing or malformed body', () => {
    expect(() => validateSubscription(undefined)).toThrow(ValidationError);
    expect(() => validateSubscription('string')).toThrow(ValidationError);
    expect(() => validateSubscription({ endpoint: 'https://x/y' })).toThrow(/keys/);
  });

  it('rejects a non-https endpoint', () => {
    expect(() =>
      validateSubscription({ ...goodSubscription, endpoint: 'http://web.push.apple.com/abc' }),
    ).toThrow(/https/);
  });

  it('rejects an endpoint that is not a URL', () => {
    expect(() => validateSubscription({ ...goodSubscription, endpoint: 'not a url' })).toThrow();
  });

  it('rejects oversized values rather than truncating them', () => {
    expect(() =>
      validateSubscription({ ...goodSubscription, endpoint: `https://x.test/${'a'.repeat(600)}` }),
    ).toThrow(/too long/);
  });
});

describe('timezone validation', () => {
  it('accepts real IANA zones', () => {
    expect(validateTimezone('America/New_York')).toBe('America/New_York');
    expect(validateTimezone('Asia/Dhaka')).toBe('Asia/Dhaka');
  });

  it('defaults to UTC when absent', () => {
    expect(validateTimezone(undefined)).toBe('UTC');
  });

  it('rejects invented zones', () => {
    expect(() => validateTimezone('Mars/Olympus')).toThrow(ValidationError);
    expect(() => validateTimezone('UTC-5')).toThrow(ValidationError);
  });
});

describe('schedule validation (spec §26)', () => {
  it('accepts and sorts valid entries', () => {
    const result = validateSchedule(
      [
        { prayer: 'isha', fireAt: inHours(9) },
        { prayer: 'maghrib', fireAt: inHours(7) },
      ],
      now,
    );

    expect(result.map((entry: { prayer: string }) => entry.prayer)).toEqual(['maghrib', 'isha']);
    expect(result[0].fireAt).toBeInstanceOf(Date);
  });

  it('drops entries in the past instead of storing them', () => {
    const result = validateSchedule(
      [
        { prayer: 'fajr', fireAt: inHours(-3) },
        { prayer: 'dhuhr', fireAt: inHours(1) },
      ],
      now,
    );
    expect(result).toHaveLength(1);
    expect(result[0].prayer).toBe('dhuhr');
  });

  it('drops entries beyond the allowed horizon', () => {
    expect(validateSchedule([{ prayer: 'fajr', fireAt: inHours(24 * 30) }], now)).toEqual([]);
  });

  it('removes duplicates', () => {
    const at = inHours(4);
    const result = validateSchedule(
      [
        { prayer: 'asr', fireAt: at },
        { prayer: 'asr', fireAt: at },
      ],
      now,
    );
    expect(result).toHaveLength(1);
  });

  it('rejects an unknown prayer name', () => {
    expect(() => validateSchedule([{ prayer: 'sunrise', fireAt: inHours(1) }], now)).toThrow(/unknown prayer/);
    expect(() => validateSchedule([{ prayer: 'DROP TABLE', fireAt: inHours(1) }], now)).toThrow();
  });

  it('rejects an unparseable timestamp', () => {
    expect(() => validateSchedule([{ prayer: 'fajr', fireAt: 'tomorrow' }], now)).toThrow(/ISO/);
  });

  it('rejects a payload large enough to be abusive', () => {
    const entries = Array.from({ length: MAX_SCHEDULE_ENTRIES + 1 }, (_, i) => ({
      prayer: 'fajr',
      fireAt: inHours(i + 1),
    }));
    expect(() => validateSchedule(entries, now)).toThrow(/exceed/);
  });

  it('rejects a non-array schedule', () => {
    expect(() => validateSchedule({ prayer: 'fajr' } as never, now)).toThrow(/array/);
  });

  it('treats an empty schedule as valid, which is how Mute all works', () => {
    expect(validateSchedule([], now)).toEqual([]);
  });
});

describe('coordinate handling (spec §10)', () => {
  it('rounds to two decimals server-side as well as on the client', () => {
    expect(validateCoarseCoordinates('40.6412345', '-73.9812345')).toEqual({
      latitude: 40.64,
      longitude: -73.98,
    });
  });

  it('rejects impossible coordinates', () => {
    expect(() => validateCoarseCoordinates('91', '0')).toThrow(ValidationError);
    expect(() => validateCoarseCoordinates('0', '181')).toThrow(ValidationError);
    expect(() => validateCoarseCoordinates('abc', '0')).toThrow(ValidationError);
  });

  it('builds a stable cache key', () => {
    expect(coarseKey(40.64, -73.98)).toBe('40.64,-73.98');
  });
});

describe('MySQL datetime conversion (spec §17)', () => {
  it('always writes UTC, never a local offset', () => {
    expect(toMysqlUtc(new Date('2026-09-08T23:16:28Z'))).toBe('2026-09-08 23:16:28');
    // Same instant, expressed with an offset: the stored value must not change.
    expect(toMysqlUtc(new Date('2026-09-08T19:16:28-04:00'))).toBe('2026-09-08 23:16:28');
  });
});
