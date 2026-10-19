/** Coerces loosely typed field values into numbers, ISO dates, times of day and text. */

/** A time of day; `minutes` counts from midnight. */
export interface TimeOfDay {
  hour: number;
  minute: number;
  minutes: number;
}

/** A number, or null when blank or unreadable; blank is "not stated", never zero. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = toText(value);
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The leading `yyyy-MM-dd` of a value, or null when it has none. */
export function toIsoDate(value: unknown): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(toText(value));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** The time of day in `yyyy-MM-ddTHH:mm…`, or null when the value carries only a date. */
export function toTimeOfDay(value: unknown): TimeOfDay | null {
  const match = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(toText(value));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return { hour, minute, minutes: hour * 60 + minute };
}

/** Trimmed text, or '' for null and undefined. */
export function toText(value: unknown): string {
  return String(value ?? '').trim();
}
