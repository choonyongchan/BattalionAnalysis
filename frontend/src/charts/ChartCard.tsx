/**
 * The frame every chart sits in: title, context, coverage, and the chart/table toggle.
 * The card clones its chart with a `view` prop and asks the chart's own `isEmpty(props)` whether it has
 * data, so nothing is described twice. An empty chart is a sentence (`empty`), never an empty axis.
 */

import { cloneElement, type ComponentChildren, type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Segmented, VIEW_OPTIONS, type View } from '../components/Segmented.tsx';

/** What every chart component accepts from its card. */
export interface ChartViewProps {
  view?: View;
}

/** A chart component that can say it has nothing to draw. */
type ChartType = { isEmpty?: (props: unknown) => boolean };

/** Whether the chart says it has nothing to show (a chart without `isEmpty` is assumed to have something). */
function isBlank(chart: VNode | undefined): boolean {
  return Boolean(chart && (chart.type as ChartType).isEmpty?.(chart.props));
}

/** A card holding exactly one chart component and its table twin; `controls` sit beside the toggle. */
export function ChartCard({
  title,
  note,
  coverage,
  empty,
  controls,
  children,
}: {
  title: string;
  note?: string;
  coverage?: string;
  empty?: string;
  controls?: ComponentChildren;
  children: VNode<ChartViewProps>;
}) {
  const [view, setView] = useState<View>('chart');
  const blank = isBlank(children);
  return (
    <section class="card">
      <div class="card__head">
        <h3 class="card__title">{title}</h3>
        {controls ? <div class="card__controls">{controls}</div> : null}
        {blank ? null : <Segmented options={VIEW_OPTIONS} value={view} onChange={setView} label={title + ': chart or table'} />}
      </div>
      {note ? <p class="card__note">{note}</p> : null}
      {blank ? <p class="empty">{empty || 'Nothing to draw for this selection.'}</p> : cloneElement(children, { view })}
      {coverage && !blank ? <p class="coverage">{coverage}</p> : null}
    </section>
  );
}
