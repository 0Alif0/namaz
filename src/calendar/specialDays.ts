/**
 * Special Islamic days (spec §8).
 *
 * A small local table. Only one entry is ever shown, and only when it applies —
 * there is no calendar list anywhere in the UI.
 *
 * Because `currentHijriDate()` rolls the date over at Maghrib, "night of"
 * observances (Shab-e-Meraj, Shab-e-Barat, Shab-e-Qadr) appear from sunset on the
 * preceding evening, which is when they are actually observed.
 *
 * Occasions whose real date depends on a local moon sighting are flagged
 * `moonDependent` and the UI phrases them as expected rather than certain.
 */

import type { HijriDate } from './hijri';

export interface SpecialDay {
  name: string;
  /** True when the observance is a night, beginning at Maghrib. */
  isNight: boolean;
  /** True when the actual date commonly shifts with local moon sighting. */
  moonDependent: boolean;
}

interface Rule {
  month: number;
  days: number[];
  name: string;
  isNight?: boolean;
  moonDependent?: boolean;
  /** Lower number wins when two rules match the same date. */
  priority?: number;
}

const RULES: Rule[] = [
  { month: 1, days: [1], name: 'Islamic New Year', moonDependent: true, priority: 1 },
  { month: 1, days: [10], name: 'Ashura', moonDependent: true, priority: 1 },
  { month: 3, days: [12], name: 'Mawlid an-Nabi', moonDependent: true, priority: 1 },
  { month: 7, days: [27], name: 'Shab-e-Meraj', isNight: true, priority: 1 },
  { month: 8, days: [15], name: 'Shab-e-Barat', isNight: true, priority: 1 },
  {
    month: 9,
    days: [27],
    name: 'Shab-e-Qadr / Laylat al-Qadr',
    isNight: true,
    moonDependent: true,
    priority: 1,
  },
  {
    month: 9,
    days: [21, 22, 23, 24, 25, 26, 28, 29, 30],
    name: 'Last ten nights of Ramadan',
    isNight: true,
    moonDependent: true,
    priority: 2,
  },
  {
    month: 9,
    days: Array.from({ length: 20 }, (_, i) => i + 1),
    name: 'Ramadan',
    moonDependent: true,
    priority: 3,
  },
  { month: 10, days: [1], name: 'Eid al-Fitr', moonDependent: true, priority: 1 },
  { month: 12, days: [9], name: 'Day of Arafah', moonDependent: true, priority: 1 },
  { month: 12, days: [10], name: 'Eid al-Adha', moonDependent: true, priority: 1 },
];

export function findSpecialDay(hijri: Pick<HijriDate, 'month' | 'day'>): SpecialDay | null {
  const matches = RULES.filter(
    (rule) => rule.month === hijri.month && rule.days.includes(hijri.day),
  ).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

  const rule = matches[0];
  if (!rule) return null;

  return {
    name: rule.name,
    isNight: rule.isNight ?? false,
    moonDependent: rule.moonDependent ?? false,
  };
}

/** One short line shown under a moon-dependent occasion. Never claims certainty. */
export function specialDayNote(day: SpecialDay): string | null {
  return day.moonDependent ? 'Expected date. Confirm with your local moon sighting.' : null;
}
