/**
 * Push permission and subscription (spec §25, §26).
 *
 * Nothing in this module runs on page load. `ensurePushReady()` is called only
 * after the user turns a prayer on.
 *
 * iOS reality check: Web Push works on iOS 16.4+ and only when the app has been
 * added to the Home Screen. In plain Safari `Notification` is undefined, and we
 * say so plainly rather than presenting a toggle that silently does nothing.
 */

import type { ScheduleEntry } from './schedule';
import type { NotificationPrefs } from '../storage/prefs';

export type PushAvailability =
  | 'available'
  | 'requires-home-screen'
  | 'no-backend'
  | 'unsupported'
  | 'permission-denied';

const API_BASE = (import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
  return iosStandalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function checkPushAvailability(): PushAvailability {
  if (typeof window === 'undefined') return 'unsupported';

  // A frontend-only deployment (GitHub Pages, say) has no server to send the
  // push. Say so up front rather than letting the user switch prayers on and
  // then fail at the subscribe step.
  if (!API_BASE) return 'no-backend';

  const hasApis =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  if (!hasApis) {
    return isIOS() && !isStandalone() ? 'requires-home-screen' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'permission-denied';
  return 'available';
}

/** Asks the browser for permission. Must be called from a user gesture. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function fetchVapidPublicKey(): Promise<string> {
  const response = await fetch(apiUrl('/api/vapid-public-key'));
  if (!response.ok) throw new Error('Could not reach the notification service');
  const data = (await response.json()) as { publicKey?: string };
  if (!data.publicKey) throw new Error('Notification service is not configured');
  return data.publicKey;
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Subscribes if needed and returns the subscription. */
export async function ensurePushSubscription(): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  const publicKey = await fetchVapidPublicKey();
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
}

export interface SyncPayload {
  subscription: PushSubscriptionJSON;
  timezone: string;
  prefs: NotificationPrefs;
  schedule: ScheduleEntry[];
}

/** Uploads the subscription and the computed schedule. No coordinates are sent. */
export async function syncSchedule(payload: SyncPayload): Promise<void> {
  const response = await fetch(apiUrl('/api/schedule'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('Could not save your notification schedule');
  }
}

export async function unsubscribePush(): Promise<void> {
  const subscription = await getPushSubscription();
  if (!subscription) return;

  await fetch(apiUrl('/api/unsubscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);

  await subscription.unsubscribe().catch(() => undefined);
}
