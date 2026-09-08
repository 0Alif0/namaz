import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allOff,
  allOn,
  anyEnabled,
  defaultNotificationPrefs,
  loadHijriOffset,
  loadNotificationPrefs,
  NOTIFIABLE_PRAYERS,
  saveHijriOffset,
  saveNotificationPrefs,
  togglePrayer,
  type NotificationPrefs,
} from '../src/storage/prefs';
import { buildSchedule } from '../src/notifications/schedule';

/** Minimal localStorage that survives a simulated reload. */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

const store = new MemoryStorage();
vi.stubGlobal('localStorage', store);

beforeEach(() => store.clear());

describe('notification switches (spec §22, §45)', () => {
  it('starts with every prayer off so nothing is enabled without consent', () => {
    const prefs = loadNotificationPrefs();
    for (const prayer of NOTIFIABLE_PRAYERS) expect(prefs[prayer]).toBe(false);
    expect(anyEnabled(prefs)).toBe(false);
  });

  it('covers exactly the six controls the screen shows', () => {
    expect([...NOTIFIABLE_PRAYERS]).toEqual(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'tahajjud']);
    expect([...NOTIFIABLE_PRAYERS]).not.toContain('sunrise');
  });

  it('walks the full sequence from spec §45', () => {
    // 1. initial state
    let prefs = loadNotificationPrefs();
    expect(anyEnabled(prefs)).toBe(false);

    prefs = allOn();
    saveNotificationPrefs(prefs);

    // 2. toggle one off
    prefs = togglePrayer(prefs, 'dhuhr');
    saveNotificationPrefs(prefs);
    expect(loadNotificationPrefs().dhuhr).toBe(false);
    expect(loadNotificationPrefs().fajr).toBe(true);

    // 3. toggle it back on
    prefs = togglePrayer(prefs, 'dhuhr');
    saveNotificationPrefs(prefs);
    expect(loadNotificationPrefs().dhuhr).toBe(true);

    // 4-5. mute all
    prefs = allOff();
    saveNotificationPrefs(prefs);
    for (const prayer of NOTIFIABLE_PRAYERS) expect(loadNotificationPrefs()[prayer]).toBe(false);

    // 6-7. enable all
    prefs = allOn();
    saveNotificationPrefs(prefs);
    for (const prayer of NOTIFIABLE_PRAYERS) expect(loadNotificationPrefs()[prayer]).toBe(true);

    // 8-9. reload
    const afterReload = loadNotificationPrefs();
    for (const prayer of NOTIFIABLE_PRAYERS) expect(afterReload[prayer]).toBe(true);
  });

  it('keeps a mixed state across a reload (spec §22)', () => {
    const mixed: NotificationPrefs = {
      fajr: true, dhuhr: false, asr: true, maghrib: true, isha: false, tahajjud: true,
    };
    saveNotificationPrefs(mixed);
    expect(loadNotificationPrefs()).toEqual(mixed);
  });

  it('keeps everything off across a reload after Mute all (spec §23)', () => {
    saveNotificationPrefs(allOn());
    saveNotificationPrefs(allOff());
    expect(anyEnabled(loadNotificationPrefs())).toBe(false);
  });

  it('does not mutate the object it is given', () => {
    const prefs = defaultNotificationPrefs();
    const next = togglePrayer(prefs, 'fajr');
    expect(prefs.fajr).toBe(false);
    expect(next.fajr).toBe(true);
  });

  it('survives corrupted storage without losing the app', () => {
    localStorage.setItem('namaz.notifications.v1', '{not json');
    expect(loadNotificationPrefs()).toEqual(defaultNotificationPrefs());
  });

  it('ignores unexpected values in stored preferences', () => {
    localStorage.setItem(
      'namaz.notifications.v1',
      JSON.stringify({ fajr: 'yes', dhuhr: true, nonsense: true }),
    );
    const prefs = loadNotificationPrefs();
    expect(prefs.fajr).toBe(false);
    expect(prefs.dhuhr).toBe(true);
  });

  it('persists the Hijri day offset', () => {
    expect(loadHijriOffset()).toBe(0);
    saveHijriOffset(1);
    expect(loadHijriOffset()).toBe(1);
    saveHijriOffset(-1);
    expect(loadHijriOffset()).toBe(-1);
  });
});

describe('push schedule built on the device (spec §26)', () => {
  const NY = { latitude: 40.64, longitude: -73.98, timezone: 'America/New_York' };
  const from = new Date('2026-09-08T12:00:00Z');

  it('schedules nothing when every prayer is off', () => {
    expect(buildSchedule({ ...NY, prefs: allOff(), from })).toEqual([]);
  });

  it('schedules six prayers a day for seven days when everything is on', () => {
    const schedule = buildSchedule({ ...NY, prefs: allOn(), from, days: 7 });

    // Fajr, Dhuhr and Asr on day one are already past at 08:00 local.
    expect(schedule.length).toBeGreaterThan(35);
    expect(schedule.length).toBeLessThanOrEqual(42);
  });

  it('never schedules a moment in the past', () => {
    const schedule = buildSchedule({ ...NY, prefs: allOn(), from });
    for (const entry of schedule) {
      expect(Date.parse(entry.fireAt)).toBeGreaterThan(from.getTime());
    }
  });

  it('is sorted and free of sunrise', () => {
    const schedule = buildSchedule({ ...NY, prefs: allOn(), from });
    const timestamps = schedule.map((entry) => Date.parse(entry.fireAt));
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
    expect(schedule.some((entry) => (entry.prayer as string) === 'sunrise')).toBe(false);
  });

  it('only schedules the prayers that are switched on', () => {
    const prefs: NotificationPrefs = {
      fajr: true, dhuhr: false, asr: false, maghrib: false, isha: false, tahajjud: false,
    };
    const schedule = buildSchedule({ ...NY, prefs, from });
    expect(new Set(schedule.map((entry) => entry.prayer))).toEqual(new Set(['fajr']));
  });

  it('includes Tahajjud at the start of the last third', () => {
    const prefs: NotificationPrefs = {
      fajr: false, dhuhr: false, asr: false, maghrib: false, isha: false, tahajjud: true,
    };
    const schedule = buildSchedule({ ...NY, prefs, from, days: 1 });
    expect(schedule).toHaveLength(1);

    const fired = new Intl.DateTimeFormat('en-US', {
      timeZone: NY.timezone, hour: 'numeric', minute: '2-digit',
    }).format(new Date(schedule[0].fireAt));
    expect(fired).toBe('1:54 AM');
  });

  it('sends only instants, never coordinates', () => {
    const schedule = buildSchedule({ ...NY, prefs: allOn(), from, days: 1 });
    const serialised = JSON.stringify(schedule);

    expect(serialised).not.toContain('40.64');
    expect(serialised).not.toContain('-73.98');
    expect(Object.keys(schedule[0]).sort()).toEqual(['fireAt', 'prayer']);
  });

  it('skips days it cannot calculate rather than scheduling wrong times', () => {
    const tromso = { latitude: 69.6492, longitude: 18.9553, timezone: 'Europe/Oslo' };
    const schedule = buildSchedule({
      ...tromso,
      prefs: allOn(),
      from: new Date('2026-06-18T12:00:00Z'),
      days: 7,
    });

    // Polar day: no valid solar events, so nothing is scheduled and nothing throws.
    expect(schedule).toEqual([]);
  });
});
