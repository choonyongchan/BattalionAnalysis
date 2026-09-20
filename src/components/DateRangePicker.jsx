/**
 * A two-click month-grid date-range picker, plus the preset buttons beside it.
 *
 * Ported from the previous implementation's hand-rolled `calendar.js`: same interaction
 * (click a start day, click an end day, or Clear), same reason for being hand-rolled
 * rather than a dependency — a date-range picker is a small, well-understood control, and
 * a library earns its weight only when the control is not. The state that changes on
 * every click (which month is shown, the half-made selection) stays local; only the
 * committed range is reported to the caller.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { addMonths, daysOfMonth, firstOfMonth, matchPreset, PRESETS } from '../model/dateRange.js';
import { weekdayOf } from '../model/dates.js';
import { fmtDate } from '../format.js';
import { Segmented } from './Segmented.jsx';

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
 * The date-range picker: a trigger button and a popover month grid.
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
        {from || to ? fmtDate(from) + ' – ' + fmtDate(to) : 'All dates'}
      </button>

      {open ? (
        <div class="daterange__popover">
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
            <button
              type="button"
              class="calendar__clear"
              onClick={() => {
                setPendingFrom(null);
                setOpen(false);
                onChange({ from: null, to: null });
              }}
            >
              All dates
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The quick-range preset buttons beside the picker.
 * @param {{from: ?string, to: ?string, today: string,
 *     onSelect: function(string): void}} props The committed range (to find which preset
 *     it matches), today's date, and what to call with a preset name when one is chosen.
 * @returns {!preact.VNode} The preset row.
 */
export function PresetBar({ from, to, today, onSelect }) {
  return (
    <Segmented
      options={PRESETS}
      value={matchPreset(from, to, today)}
      onChange={onSelect}
      label="Quick date ranges"
    />
  );
}
