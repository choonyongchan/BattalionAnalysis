/**
 * What a page imports from the chart layer; theme, hook and ECharts stay behind it, so no page makes a
 * colour decision. Every chart draws numbers `model/` computed and renders its own table twin.
 */

export { ChartCard } from './ChartCard.tsx';

export { Bar } from './Bar.tsx';
export { Donut } from './Donut.tsx';
export { Heatmap } from './Heatmap.tsx';
export { Line } from './Line.tsx';
export { Sankey } from './Sankey.tsx';
export { Scatter } from './Scatter.tsx';
export { Timeline } from './Timeline.tsx';

// The table twin alone, for a card that is only ever a table; it matches the charts' tables.
export { TableTwin } from './TableTwin.tsx';
