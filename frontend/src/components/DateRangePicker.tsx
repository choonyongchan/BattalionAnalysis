/**
 * A calendar button opening quick ranges and a two-click month grid (hand-rolled: a small, well-understood
 * control). Click-by-click state stays local; only the committed range is reported.
 */

import { useRef, useState } from 'preact/hooks';
import { useOutsideClick } from './useOutsideClick.ts';
import type { DateRange } from '../model/dateRange.ts';
import {
  addMonths,
  daysOfMonth,
  firstOfMonth,
  isoToday,
  matchPreset,
  PRESETS,
  resolvePreset,
} from '../model/dateRange.ts';
import { weekdayOf } from '../../../shared/dates.ts';
import { fmtDate } from '../format.ts';

/** Month names for the popover header. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Two-letter weekday headers, Monday first. */
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** A first-of-month date as 'June 2026'. */
function monthLabel(isoFirst: string): string {
  const [year = 0, month = 1] = isoFirst.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/** One month's day grid; days outside `min`..`max` are disabled, the range so far is marked. */
function MonthGrid({
  shownMonth,
  min,
  max,
  from,
  to,
  onPick,
}: {
  shownMonth: string;
  min: string;
  max: string;
  from: string | null;
  to: string | null;
  onPick: (isoDate: string) => void;
}) {
  const days = daysOfMonth(shownMonth);
  const blanks = weekdayOf(shownMonth).index;

  return (
    <div class="calendar__grid">
      {WEEKDAYS.map((name) => (
        <span class="calendar__weekday" key={name}>
          {name}
        </span>
      ))}
      {Array.from({ length: blanks }, (_, index) => (
        <span class="calendar__day calendar__day--blank" key={'blank-' + index} />
      ))}
      {days.map((isoDate) => {
        const disabled = isoDate < min || isoDate > max;
        let className = 'calendar__day';
        if (from && isoDate === from) className += ' calendar__day--start';
        if (to && isoDate === to) className += ' calendar__day--end';
        if (from && to && isoDate > from && isoDate < to) className += ' calendar__day--in-range';
        return (
          <button
            key={isoDate}
            type="button"
            class={className}
            disabled={disabled}
            title={fmtDate(isoDate)}
            onClick={() => onPick(isoDate)}
          >
            {Number(isoDate.slice(8))}
          </button>
        );
      })}
    </div>
  );
}

/** A calendar glyph on the shell's 24-unit, 1.6-stroke grid. */
function CalendarGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.4" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

/** What the closed trigger says: the dates, after the preset's name when the range is one. */
function triggerLabel(from: string | null, to: string | null, preset: string | null): string {
  if (!from && !to) {
    return 'All dates';
  }
  const dates = fmtDate(from) + ' – ' + fmtDate(to);
  const match = PRESETS.find((entry) => entry.name === preset);
  return match ? match.label + ' · ' + dates : dates;
}

/** The quick ranges beside the month grid; `value` is the preset the committed range matches. */
function PresetList({ value, onSelect }: { value: string | null; onSelect: (name: string) => void }) {
  return (
    <div class="daterange__presets" role="group" aria-label="Quick date ranges">
      {PRESETS.map((preset) => (
        <button
          key={preset.name}
          type="button"
          class="daterange__preset"
          aria-pressed={value === preset.name}
          onClick={() => onSelect(preset.name)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

/** The picker: `min`..`max` are selectable, `from`/`to` the committed range (both null for "All"). */
export function DateRangePicker({
  min,
  max,
  from,
  to,
  onChange,
}: {
  min: string;
  max: string;
  from: string | null;
  to: string | null;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [shownMonth, setShownMonth] = useState(firstOfMonth(to || from || max));
  const rootRef = useRef<HTMLDivElement>(null);

  /** Closes the popover and drops a half-made selection. */
  const close = () => {
    setOpen(false);
    setPendingFrom(null);
  };
  useOutsideClick(rootRef, open, close);

  /** A first click starts a pending range; the second commits it. */
  function pickDay(isoDate: string) {
    if (pendingFrom === null) {
      setPendingFrom(isoDate);
      return;
    }
    const nextFrom = pendingFrom < isoDate ? pendingFrom : isoDate;
    const nextTo = pendingFrom < isoDate ? isoDate : pendingFrom;
    close();
    onChange({ from: nextFrom, to: nextTo });
  }

  const rangeFrom = pendingFrom || from;
  const rangeTo = pendingFrom ? null : to;
  const today = isoToday();
  const preset = matchPreset(from, to, today);

  /** Commits a quick range and closes the popover. */
  function pickPreset(name: string) {
    close();
    onChange(resolvePreset(name, today));
  }

  return (
    <div class="daterange" ref={rootRef}>
      <button
        class="daterange__trigger field"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setShownMonth(firstOfMonth(to || from || max));
          setPendingFrom(null);
          setOpen(true);
        }}
      >
        <CalendarGlyph />
        <span>{triggerLabel(from, to, preset)}</span>
      </button>

      {open ? (
        <div class="daterange__popover" role="dialog" aria-label="Choose dates">
          <PresetList value={preset} onSelect={pickPreset} />
          <div class="calendar">
            <div class="calendar__head">
              <button
                type="button"
                class="calendar__nav"
                aria-label="Previous month"
                disabled={shownMonth <= firstOfMonth(min)}
                onClick={() => setShownMonth(addMonths(shownMonth, -1))}
              >
                ‹
              </button>
              <span class="calendar__month">{monthLabel(shownMonth)}</span>
              <button
                type="button"
                class="calendar__nav"
                aria-label="Next month"
                disabled={shownMonth >= firstOfMonth(max)}
                onClick={() => setShownMonth(addMonths(shownMonth, 1))}
              >
                ›
              </button>
            </div>
            <MonthGrid shownMonth={shownMonth} min={min} max={max} from={rangeFrom} to={rangeTo} onPick={pickDay} />
            <p class="calendar__hint">{pendingFrom ? 'Pick the end date' : 'Pick the start date'}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
