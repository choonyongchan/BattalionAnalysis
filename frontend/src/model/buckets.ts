/**
 * Groups dates into the report-sick chart's grains. Every key sorts chronologically as a string:
 * a rotation is keyed by its start date, and a date in no rotation sorts last rather than being dropped.
 */

import { addDays, MONTH_NAMES, weekdayOf } from '../../../shared/dates.ts';
import { rotationOf, type Rotation } from '../../../shared/rotations.ts';

/** Key of the bucket for dates in no rotation; past any real rotation, so it sorts last. */
const NO_ROTATION_KEY = '9999-12-31';

/** The grouping options, in display order. */
export const GRANULARITIES = [
  { name: 'daily', label: 'Daily' },
  { name: 'weekly', label: 'Weekly' },
  { name: 'monthly', label: 'Monthly' },
  { name: 'rotational', label: 'Rotational' },
] as const;

export type Granularity = (typeof GRANULARITIES)[number]['name'];

/** A bucket's sort key and axis label. */
export interface Bucket {
  key: string;
  label: string;
}

/** Short month name of a `yyyy-MM…` string. */
const monthName = (iso: string): string => MONTH_NAMES[Number(iso.slice(5, 7)) - 1]!;

/** The bucket a date belongs to at a grain; `rotations` matter only for the rotational grain. */
export function bucketOf(isoDate: string, granularity: string, rotations: Rotation[]): Bucket {
  if (granularity === 'weekly') {
    const monday = addDays(isoDate, -weekdayOf(isoDate).index);
    return { key: monday, label: `Week of ${Number(monday.slice(8, 10))} ${monthName(monday)}` };
  }
  if (granularity === 'monthly') {
    return { key: isoDate.slice(0, 7), label: `${monthName(isoDate)} ${isoDate.slice(0, 4)}` };
  }
  if (granularity === 'rotational') {
    const name = rotationOf(isoDate, rotations);
    const rotation = rotations.find((entry) => entry.name === name);
    return rotation ? { key: rotation.start, label: rotation.name } : { key: NO_ROTATION_KEY, label: 'No rotation' };
  }
  return { key: isoDate, label: `${weekdayOf(isoDate).name} ${Number(isoDate.slice(8, 10))} ${monthName(isoDate)}` };
}
