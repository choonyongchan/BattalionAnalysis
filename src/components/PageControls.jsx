/**
 * The control bar every page opens with: which company, and which span of dates.
 *
 * It owns no data — it reads and writes the `company`, `dateFrom` and `dateTo` signals
 * directly, so the shell stays a function of state and a page can still be rendered in
 * isolation. It is pinned to the top of the content column so the reader can retarget the
 * whole page without scrolling back up.
 *
 * The company is a segmented control rather than a dropdown: six short options fit in one
 * row, every choice is visible without opening anything, and switching between two
 * companies is one click instead of two. The date range is one calendar button; its quick
 * ranges live inside the popover, so the bar carries two controls, not three.
 */

import { company, dateFrom, dateTo } from '../app/state.js';
import { COMPANIES } from '../model/domain.js';
import { ALL_COMPANIES } from '../model/scope.js';
import { DateRangePicker } from './DateRangePicker.jsx';
import { Segmented } from './Segmented.jsx';

/**
 * The company options, "All" first, then parade order.
 * @type {Array<{name: string, label: string}>}
 */
const COMPANY_OPTIONS = [
  { name: ALL_COMPANIES, label: 'All' },
  ...COMPANIES.map((name) => ({ name, label: name })),
];

/**
 * The sticky company + date-range bar.
 * @param {{min: string, max: string, showRange?: boolean, children?: *}} props The
 *     selectable date bounds (a page passes its full, unscoped parade-date span so the
 *     range does not shrink when a company is picked); whether to show the date-range
 *     control — ORBAT and Soldier, which have no range, pass `false`; and any page-own
 *     control to sit in the same row, such as ORBAT's single-date picker.
 * @returns {!preact.VNode} The control bar.
 */
export function PageControls({ min, max, showRange = true, children }) {
  return (
    <div class="pagecontrols">
      <div class="pagecontrols__companies">
        <Segmented
          options={COMPANY_OPTIONS}
          value={company.value}
          onChange={(name) => {
            company.value = name;
          }}
          label="Company"
          radio
        />
      </div>

      {showRange ? (
        <DateRangePicker
          min={min}
          max={max}
          from={dateFrom.value}
          to={dateTo.value}
          onChange={({ from, to }) => {
            dateFrom.value = from;
            dateTo.value = to;
          }}
        />
      ) : null}

      {children}
    </div>
  );
}
