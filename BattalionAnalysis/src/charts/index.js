/**
 * What a page imports from the chart layer.
 *
 * One entry point so a page never reaches past it into `theme.js`, `useChart.js` or
 * `echarts.js` — those are how the layer works, not what it offers. A page that finds
 * itself wanting `readPalette` is about to write a colour decision into a page file, which
 * is the thing this whole directory is arranged to prevent.
 *
 * Everything here follows the same contract: the component is handed data that
 * `src/model/` has already computed, it draws it, and it renders its own table twin when
 * `ChartCard` asks for one. No component in this directory computes a metric.
 */

export { ChartCard } from './ChartCard.jsx';

export { Bar } from './Bar.jsx';
export { Donut } from './Donut.jsx';
export { GroupedBar } from './GroupedBar.jsx';
export { Heatmap } from './Heatmap.jsx';
export { Histogram } from './Histogram.jsx';
export { Line } from './Line.jsx';
export { Sankey } from './Sankey.jsx';
export { StackedBar } from './StackedBar.jsx';
export { Timeline } from './Timeline.jsx';
export { Tree } from './Tree.jsx';
export { WordCloud } from './WordCloud.jsx';

// The table twin on its own, for the handful of card-shaped things that are a table and
// never a chart — a data-quality issue list, say. It is the same component the charts
// render, so those tables match the chart cards' tables exactly.
export { TableTwin } from './TableTwin.jsx';
