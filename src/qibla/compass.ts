/**
 * Device compass (spec §20).
 *
 * Safari on iOS exposes `webkitCompassHeading`, which is a *true* heading already
 * corrected for magnetic declination. Other browsers expose `alpha`, which is only
 * a usable heading when `absolute` is true. Anything else and we report the
 * compass as unavailable rather than showing a needle that means nothing.
 *
 * iOS also requires DeviceOrientationEvent.requestPermission() to be called from
 * inside a user gesture, which is why nothing here runs on page load.
 */

export type CompassStatus =
  | 'idle'
  | 'unsupported'
  | 'permission-required'
  | 'permission-denied'
  | 'active'
  | 'no-heading';

export interface CompassReading {
  /** Degrees clockwise from north, 0-360. */
  heading: number;
  /** True when corrected for magnetic declination (iOS webkitCompassHeading). */
  isTrueHeading: boolean;
}

interface IOSDeviceOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

type PermissionRequestingConstructor = {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
};

export function compassIsSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

export function compassNeedsPermission(): boolean {
  if (!compassIsSupported()) return false;
  const ctor = window.DeviceOrientationEvent as unknown as PermissionRequestingConstructor;
  return typeof ctor.requestPermission === 'function';
}

export async function requestCompassPermission(): Promise<'granted' | 'denied' | 'unnecessary'> {
  if (!compassIsSupported()) return 'denied';
  if (!compassNeedsPermission()) return 'unnecessary';

  const ctor = window.DeviceOrientationEvent as unknown as PermissionRequestingConstructor;
  try {
    const result = await ctor.requestPermission!();
    return result === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

function readHeading(event: IOSDeviceOrientationEvent): CompassReading | null {
  if (typeof event.webkitCompassHeading === 'number' && !Number.isNaN(event.webkitCompassHeading)) {
    return { heading: event.webkitCompassHeading, isTrueHeading: true };
  }

  // `alpha` counts anticlockwise from north, so a compass heading is 360 - alpha.
  if (event.absolute && typeof event.alpha === 'number' && !Number.isNaN(event.alpha)) {
    return { heading: (360 - event.alpha) % 360, isTrueHeading: false };
  }

  return null;
}

/**
 * Starts listening. Returns a stop function.
 * `onReading` fires with null if the device produces events but no usable heading.
 */
export function watchCompass(onReading: (reading: CompassReading | null) => void): () => void {
  if (!compassIsSupported()) {
    onReading(null);
    return () => {};
  }

  const listener = (event: Event) => {
    onReading(readHeading(event as IOSDeviceOrientationEvent));
  };

  // `deviceorientationabsolute` is the correct event on Chrome/Android.
  const eventName = 'ondeviceorientationabsolute' in window
    ? 'deviceorientationabsolute'
    : 'deviceorientation';

  window.addEventListener(eventName, listener, true);
  return () => window.removeEventListener(eventName, listener, true);
}

/** Rotation to apply to the Qibla needle given the current phone heading. */
export function qiblaNeedleRotation(qiblaBearing: number, heading: number): number {
  const rotation = (qiblaBearing - heading) % 360;
  return rotation < 0 ? rotation + 360 : rotation;
}

/** True when the phone is pointing at the Qibla within `tolerance` degrees. */
export function isAlignedWithQibla(qiblaBearing: number, heading: number, tolerance = 5): boolean {
  return angularSeparation(qiblaBearing, heading) <= tolerance;
}

/** Smallest angle between two bearings, 0-180, correct across the 0/360 wrap. */
export function angularSeparation(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}
