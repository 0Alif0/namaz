/**
 * Prayer time engine.
 *
 * Library:  adhan v4.4.4 (MIT, Batoul Apps), bundled locally — no CDN.
 *           Astronomy is taken directly from Jean Meeus, "Astronomical
 *           Algorithms". We do not implement solar geometry ourselves.
 *
 * Default:  CalculationMethod.NorthAmerica() — the library's ISNA method.
 *           Its parameters are asserted in tests/prayer.test.ts so that a
 *           library upgrade which silently changes them fails the build:
 *             fajrAngle 15, ishaAngle 15, ishaInterval 0,
 *             madhab "shafi" (standard Asr), rounding "nearest".
 *
 * This module contains no UI and no React.
 */

import {
  CalculationMethod,
  CalculationParameters,
  Coordinates,
  HighLatitudeRule,
  Madhab,
  PrayerTimes,
} from 'adhan';
import { asRuntimeLocalDate, civilDate, isValidDate, type CivilDate } from '../utils/time';

export type CalculationMethodName = 'ISNA';
export type AsrMethod = 'standard' | 'hanafi';

export const DEFAULT_CALCULATION_METHOD: CalculationMethodName = 'ISNA';
export const DEFAULT_ASR_METHOD: AsrMethod = 'standard';

/** Above this absolute latitude, ISNA's twilight angles stop behaving sensibly. */
export const HIGH_LATITUDE_THRESHOLD = 48;

export interface PrayerTimesInput {
  latitude: number;
  longitude: number;
  /** Any instant on the day you want. Interpreted in `timezone`. */
  date: Date;
  /** IANA zone, e.g. "America/New_York". */
  timezone: string;
  calculationMethod?: CalculationMethodName;
  asrMethod?: AsrMethod;
}

export interface PrayerTimesResult {
  fajr: Date;
  sunrise: Date;
  dhuhr: Date;
  asr: Date;
  maghrib: Date;
  isha: Date;
}

export type PrayerName = keyof PrayerTimesResult;

export const PRAYER_ORDER: PrayerName[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** Thrown when the engine cannot produce a full, ordered set of times. */
export class PrayerCalculationError extends Error {
  readonly reason: 'invalid-input' | 'undefined-events' | 'out-of-order';

  constructor(reason: PrayerCalculationError['reason'], message: string) {
    super(message);
    this.name = 'PrayerCalculationError';
    this.reason = reason;
  }
}

function buildParameters(
  method: CalculationMethodName,
  asrMethod: AsrMethod,
  latitude: number,
): CalculationParameters {
  if (method !== 'ISNA') {
    throw new PrayerCalculationError('invalid-input', `Unsupported calculation method: ${method}`);
  }

  const params = CalculationMethod.NorthAmerica();
  params.madhab = asrMethod === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;

  // ISNA's own default is MiddleOfTheNight. Near the poles that produces Fajr
  // and Isha within minutes of each other; adhan's `recommended()` picks a
  // better-behaved rule for the latitude. Applied automatically — the user is
  // never asked about high-latitude formulas (spec §4).
  if (Math.abs(latitude) >= HIGH_LATITUDE_THRESHOLD) {
    params.highLatitudeRule = HighLatitudeRule.recommended(new Coordinates(latitude, 0));
  }

  return params;
}

function validateCoordinates(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new PrayerCalculationError('invalid-input', `Latitude out of range: ${latitude}`);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new PrayerCalculationError('invalid-input', `Longitude out of range: ${longitude}`);
  }
}

/**
 * Prayer times for the calendar day that `date` falls on in `timezone`.
 * Throws PrayerCalculationError rather than returning placeholder times.
 */
export function calculatePrayerTimes(input: PrayerTimesInput): PrayerTimesResult {
  const {
    latitude,
    longitude,
    date,
    timezone,
    calculationMethod = DEFAULT_CALCULATION_METHOD,
    asrMethod = DEFAULT_ASR_METHOD,
  } = input;

  validateCoordinates(latitude, longitude);
  if (!isValidDate(date)) {
    throw new PrayerCalculationError('invalid-input', 'Invalid date');
  }

  const civil = civilDate(date, timezone);
  return calculatePrayerTimesForCivilDate(
    { latitude, longitude, civil, calculationMethod, asrMethod },
  );
}

interface CivilInput {
  latitude: number;
  longitude: number;
  civil: CivilDate;
  calculationMethod?: CalculationMethodName;
  asrMethod?: AsrMethod;
}

/** Same as calculatePrayerTimes but takes an explicit civil date. */
export function calculatePrayerTimesForCivilDate(input: CivilInput): PrayerTimesResult {
  const {
    latitude,
    longitude,
    civil,
    calculationMethod = DEFAULT_CALCULATION_METHOD,
    asrMethod = DEFAULT_ASR_METHOD,
  } = input;

  validateCoordinates(latitude, longitude);

  const coordinates = new Coordinates(latitude, longitude);
  const params = buildParameters(calculationMethod, asrMethod, latitude);
  const times = new PrayerTimes(coordinates, asRuntimeLocalDate(civil), params);

  const result: Partial<PrayerTimesResult> = {};
  const undefinedEvents: string[] = [];

  for (const name of PRAYER_ORDER) {
    const value = times[name] as Date | null;
    if (!isValidDate(value)) {
      undefinedEvents.push(name);
    } else {
      result[name] = value;
    }
  }

  if (undefinedEvents.length > 0) {
    // Polar day / polar night: the sun never reaches the required altitude, so
    // the event genuinely has no time. We surface that instead of inventing one.
    throw new PrayerCalculationError(
      'undefined-events',
      `No solar event for: ${undefinedEvents.join(', ')}`,
    );
  }

  return result as PrayerTimesResult;
}

/** Qibla-independent convenience: the following day's times, same location. */
export function calculateNextDayPrayerTimes(input: PrayerTimesInput): PrayerTimesResult {
  const civil = civilDate(input.date, input.timezone);
  const next = new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
  next.setUTCDate(next.getUTCDate() + 1);

  return calculatePrayerTimesForCivilDate({
    latitude: input.latitude,
    longitude: input.longitude,
    civil: {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
    },
    calculationMethod: input.calculationMethod,
    asrMethod: input.asrMethod,
  });
}

/** The ISNA parameters actually in force, for tests and diagnostics only. */
export function describeParameters(asrMethod: AsrMethod = DEFAULT_ASR_METHOD, latitude = 0) {
  const p = buildParameters('ISNA', asrMethod, latitude);
  return {
    method: p.method,
    fajrAngle: p.fajrAngle,
    ishaAngle: p.ishaAngle,
    ishaInterval: p.ishaInterval,
    madhab: p.madhab,
    highLatitudeRule: p.highLatitudeRule,
    rounding: p.rounding,
    adjustments: p.adjustments,
  };
}
