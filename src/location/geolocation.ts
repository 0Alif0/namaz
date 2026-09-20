/**
 * Device location (spec §9, §10).
 *
 * Coordinates are used on the device and cached in localStorage. They are never
 * uploaded. The only thing that leaves the phone is a coordinate pair rounded to
 * two decimal places (~1 km), sent to our own server to look up a place name.
 */

export type LocationErrorReason = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export class LocationError extends Error {
  readonly reason: LocationErrorReason;

  constructor(reason: LocationErrorReason, message: string) {
    super(message);
    this.name = 'LocationError';
    this.reason = reason;
  }
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface PositionRequest {
  timeoutMs?: number;
  /**
   * How stale a cached fix may be, in milliseconds. Pass 0 when the point of the
   * call is to detect that the user has moved — otherwise the browser is free to
   * hand back the position it already had, and travel goes unnoticed.
   */
  maximumAgeMs?: number;
}

export function getCurrentPosition({
  timeoutMs = 15_000,
  maximumAgeMs = 60_000,
}: PositionRequest = {}): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new LocationError('unsupported', 'This device cannot provide a location.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new LocationError('denied', 'Location access was not granted.'));
        } else if (error.code === error.TIMEOUT) {
          reject(new LocationError('timeout', 'Getting your location took too long.'));
        } else {
          reject(new LocationError('unavailable', 'Your location could not be determined.'));
        }
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: maximumAgeMs },
    );
  });
}
