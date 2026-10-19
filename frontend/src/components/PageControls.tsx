/**
 * The sticky bar every page opens with: company (a segmented control, every choice visible) and date
 * range. It reads and writes the state signals directly, so pages still render in isolation.
 */

import { company, dateFrom, dateTo } from '../app/state.ts';
import { COMPANIES } from '../../../shared/domain.ts';
import { ALL_COMPANIES } from '../model/scope.ts';
import { DateRangePicker } from './DateRangePicker.tsx';
import { Segmented, type Option } from './Segmented.tsx';
import type { ComponentChildren } from 'preact';

/** The company options, "All" first, then parade order. */
const COMPANY_OPTIONS: Option[] = [
  { name: ALL_COMPANIES, label: 'All' },
  ...COMPANIES.map((name) => ({ name, label: name })),
];

/**
 * The company and date-range bar. `min`/`max` are the page's full parade-date span (so the range does not
 * shrink with a company); pages without a range pass `showRange={false}`; `children` sit in the same row.
 */
export function PageControls({
  min,
  max,
  showRange = true,
  children,
}: {
  min: string;
  max: string;
  showRange?: boolean;
  children?: ComponentChildren;
}) {
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
