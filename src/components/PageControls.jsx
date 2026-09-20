/**
 * The control bar every page opens with: which company, and which span of dates.
 *
 * It owns no data — it reads and writes the `company`, `dateFrom` and `dateTo` signals
 * directly, the same way `RangeControls` did before it, so the shell stays a function of
 * state and a page can still be rendered in isolation. The company select and the
 * date-range picker were previously a company `<select>` buried on ORBAT and a range row
 * copied into Overview and every category page; one bar now carries both, pinned to the
 * top of the content column so the reader can retarget the whole page without scrolling
 * back up.
 */

import { company, dateFrom, dateTo } from '../app/state.js';
import { COMPANIES } from '../model/domain.js';
import { ALL_COMPANIES } from '../model/scope.js';
import { isoToday, resolvePreset } from '../model/dateRange.js';
import { DateRangePicker, PresetBar } from './DateRangePicker.jsx';

/**
 * The sticky company + date-range bar.
 * @param {{min: string, max: string, showRange?: boolean}} props The selectable date
 *     bounds (a page passes its full, unscoped parade-date span so the range does not
 *     shrink when a company is picked), and whether to show the date-range controls —
 *     ORBAT and Soldier, which have no range, pass `false`.
 * @returns {!preact.VNode} The control bar.
 */
export function PageControls({ min, max, showRange = true }) {
  return (
    <div class="pagecontrols">
      <label class="control">
        <span class="field__label">Company</span>
        <select
          class="field"
          value={company.value}
          onChange={(event) => {
            company.value = event.currentTarget.value;
          }}
        >
          <option value={ALL_COMPANIES}>40 SAR</option>
          {COMPANIES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      {showRange ? (
        <div class="controlrow">
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
          <PresetBar
            from={dateFrom.value}
            to={dateTo.value}
            today={isoToday()}
            onSelect={(preset) => {
              const resolved = resolvePreset(preset, isoToday());
              dateFrom.value = resolved.from;
              dateTo.value = resolved.to;
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
