/**
 * Qibla bearing (spec §19, §42).
 *
 * Great-circle initial bearing from the observer to the Kaaba, normalised to
 * [0, 360). This is the standard spherical formula:
 *
 *   theta = atan2( sin(dLon) * cos(lat2),
 *                  cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon) )
 *
 * It is implemented here rather than imported so that tests can cross-check it
 * against adhan's independent implementation; the two agree to well under a
 * hundredth of a degree for every city we test.
 */

export const KAABA_LATITUDE = 21.4225;
export const KAABA_LONGITUDE = 39.8262;

/** Below this distance the bearing is meaningless — you are effectively there. */
export const QIBLA_MINIMUM_DISTANCE_KM = 5;

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function normalizeBearing(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function calculateQiblaBearing(latitude: number, longitude: number): number {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error(`Latitude out of range: ${latitude}`);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error(`Longitude out of range: ${longitude}`);
  }

  const lat1 = toRadians(latitude);
  const lat2 = toRadians(KAABA_LATITUDE);
  const deltaLongitude = toRadians(KAABA_LONGITUDE - longitude);

  const y = Math.sin(deltaLongitude) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLongitude);

  return normalizeBearing(toDegrees(Math.atan2(y, x)));
}

/** Great-circle distance to the Kaaba in kilometres. */
export function distanceToKaabaKm(latitude: number, longitude: number): number {
  const lat1 = toRadians(latitude);
  const lat2 = toRadians(KAABA_LATITUDE);
  const dLat = lat2 - lat1;
  const dLon = toRadians(KAABA_LONGITUDE - longitude);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** False when the observer is essentially at the Kaaba and no direction applies. */
export function qiblaIsMeaningful(latitude: number, longitude: number): boolean {
  return distanceToKaabaKm(latitude, longitude) > QIBLA_MINIMUM_DISTANCE_KM;
}

/** "NE", "ENE", ... — a plain-language cue so direction is not conveyed by the dial alone. */
export function compassPointName(bearing: number): string {
  const points = [
    'north', 'north-northeast', 'northeast', 'east-northeast',
    'east', 'east-southeast', 'southeast', 'south-southeast',
    'south', 'south-southwest', 'southwest', 'west-southwest',
    'west', 'west-northwest', 'northwest', 'north-northwest',
  ];
  return points[Math.round(normalizeBearing(bearing) / 22.5) % 16];
}
