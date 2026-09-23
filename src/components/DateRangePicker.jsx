/**
 * A calendar button that opens the quick ranges and a two-click month grid.
 *
 * Closed, the bar shows one button naming the committed range; the quick ranges ("This
 * week", "Last month", …) appear only in the popover, beside the month grid, so the bar
 * stays one control wide. Hand-rolled rather than a dependency — a date-range picker is a
 * small, well-understood control, and a library earns its weight only when the control is
 * not. The state that changes on every click (which month is shown, the half-made
 * selection) stays local; only the committed range is reported to the caller.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import {
  addMonths,
  daysOfMonth,
  firstOfMonth,
  isoToday,
  matchPreset,
  PRESETS,
  resolvePreset,
} from '../model/dateRange.js';
import { weekdayOf } from '../model/dates.js';
import { fmtDate } from '../format.js';

/** @type {string[]} Month names for the popover header. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** @type {string[]} Two-letter weekday headers, Monday first. */
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * The human label for a first-of-month ISO date, e.g. 'June 2026'.
 * @param {string} isoFirst ISO 'yyyy-MM-01'.
 * @returns {string} The label.
 */
function monthLabel(isoFirst) {
  const [year, month] = isoFirst.split('-').map(Number);
  return MONTHS[month - 1] + ' ' + year;
}

/**
 * The month grid inside the popover.
 * @param {{shownMonth: string, min: string, max: string, from: ?string, to: ?string,
 *     onPick: function(string): void}} props The month to show, the selectable bounds,
 *     the committed-or-pending range so far, and what to call when a day is clicked.
 * @returns {!preact.VNode} The grid.
 */
function MonthGrid({ shownMonth, min, max, from, to, onPick }) {
  const days = daysOfMonth(shownMonth);
  const blanks = weekdayOf(days[0]).index;

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

/**
 * A calendar glyph for the trigger, on the shell's 24-unit, 1.6-stroke grid.
 * @returns {!preact.VNode} The icon.
 */
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

/**
 * What the closed trigger says: the preset's name when the range is one, and the dates.
 * @param {?string} from Committed range start, or null.
 * @param {?string} to Committed range end, or null.
 * @param {?string} preset The matching preset's name, or null.
 * @returns {string} The label.
 */
function triggerLabel(from, to, preset) {
  if (!from && !to) {
    return 'All dates';
  }
  const dates = fmtDate(from) + ' – ' + fmtDate(to);
  const match = PRESETS.find((entry) => entry.name === preset);
  return match ? match.label + ' · ' + dates : dates;
}

/**
 * The quick ranges, stacked beside the month grid inside the popover.
 * @param {{value: ?string, onSelect: function(string): void}} props The preset the
 *     committed range matches, and what to call with a preset name.
 * @returns {!preact.VNode} The list.
 */
function PresetList({ value, onSelect }) {
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

/**
 * The date-range picker: a calendar button, and a popover of quick ranges and a month grid.
 * @param {{min: string, max: string, from: ?string, to: ?string,
 *     onChange: function({from: ?string, to: ?string}): void}} props The selectable
 *     bounds, the committed range (null/null for "All"), and the change callback.
 * @returns {!preact.VNode} The picker.
 */
export function DateRangePicker({ min, max, from, to, onChange }) {
  const [open, setOpen] = useState(false);
  const [pendingFrom, setPendingFrom] = useState(null);
  const [shownMonth, setShownMonth] = useState(firstOfMonth(to || from || max));
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    /**
     * Closes the popover on an outside click.
     * @param {!Event} event The document mousedown.
     * @returns {void}
     */
    function onDocMouseDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        setPendingFrom(null);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  /**
   * Handles a day click: the first click starts a pending range, the second commits it.
   * @param {string} isoDate The clicked day.
   * @returns {void}
   */
  function pickDay(isoDate) {
    if (pendingFrom === null) {
      setPendingFrom(isoDate);
      return;
    }
    const nextFrom = pendingFrom < isoDate ? pendingFrom : isoDate;
    const nextTo = pendingFrom < isoDate ? isoDate : pendingFrom;
    setPendingFrom(null);
    setOpen(false);
    onChange({ from: nextFrom, to: nextTo });
  }

  const rangeFrom = pendingFrom || from;
  const rangeTo = pendingFrom ? null : to;
  const today = isoToday();
  const preset = matchPreset(from, to, today);

  /**
   * Commits a quick range and closes the popover.
   * @param {string} name A `PRESETS` name.
   * @returns {void}
   */
  function pickPreset(name) {
    setPendingFrom(null);
    setOpen(false);
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
            setOpen(false);
            setPendingFrom(null);
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
