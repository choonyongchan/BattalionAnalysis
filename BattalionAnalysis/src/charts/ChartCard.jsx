/**
 * The frame every chart sits in: a title, its context, its coverage, and the toggle
 * between the chart and its table twin.
 *
 * Two decisions worth knowing before using it.
 *
 * **The card asks the chart what it holds; it is never told twice.** A card that took a
 * `table` prop alongside a chart would have two descriptions of the same data assembled at
 * two call sites, and they would drift. Instead the card clones its child with a `view`
 * prop and lets the chart render its own table from the props it is already drawing from,
 * and reads emptiness off the chart component's own `isEmpty(props)`. Adding a chart type
 * therefore means giving it a `view === 'table'` branch and an `isEmpty`; there is nothing
 * to register here.
 *
 * **An empty chart is a sentence, not an empty axis.** Only five of forty-five parade days
 * in the observed data carry all six companies, so "no data" is a normal state and a
 * common one. A blank grid with axes on it says the value is zero. The `empty` prop says
 * what is missing and what would fill it, which is the only useful thing to show.
 *
 * The coverage line is the card's, not the chart's: every figure in this dashboard is owed
 * a statement of how much of the battalion it actually covers, and putting that slot here
 * means a page cannot ship a chart without somewhere to say it.
 */

import { cloneElement } from 'preact';
import { useState } from 'preact/hooks';
import { Segmented, VIEW_OPTIONS } from '../components/Segmented.jsx';

/**
 * A card holding one chart and its table twin.
 * @param {{title: string, note: (string|undefined), coverage: (string|undefined),
 *     empty: (string|undefined), children: !Object}} props The heading; one line of
 *     context under it; the coverage line under the chart; the sentence shown in place of
 *     the chart when there is nothing to draw; and exactly one chart component as the
 *     child.
 * @returns {!Object} The card.
 */
export function ChartCard({ title, note, coverage, empty, children }) {
  const [view, setView] = useState('chart');
  const chart = Array.isArray(children) ? children[0] : children;
  const blank = isBlank_(chart);

  return (
    <section class="card">
      <div class="card__head">
        <h3 class="card__title">{title}</h3>
        {blank ? null : (
          <Segmented
            options={VIEW_OPTIONS}
            value={view}
            onChange={setView}
            label={title + ': chart or table'}
          />
        )}
      </div>
      {note ? <p class="card__note">{note}</p> : null}
      {blank ? (
        <p class="empty">{empty || 'Nothing to draw for this selection.'}</p>
      ) : (
        cloneElement(chart, { view })
      )}
      {coverage && !blank ? <p class="coverage">{coverage}</p> : null}
    </section>
  );
}

/**
 * Whether a chart component says it has nothing to draw.
 *
 * The question is asked of the component, not of the card: only the chart knows whether
 * "six series of all nulls" counts as data. A component with no `isEmpty` is assumed to
 * have something, so a new chart type fails visible rather than silent.
 * @param {?Object} chart The child element.
 * @returns {boolean} True when the chart has nothing to show.
 */
function isBlank_(chart) {
  return Boolean(chart && chart.type && chart.type.isEmpty && chart.type.isEmpty(chart.props));
}
