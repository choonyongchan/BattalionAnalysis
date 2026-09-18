/**
 * The one place ECharts is assembled.
 *
 * ECharts ships as a registry: `echarts/core` is an empty engine, and every series type,
 * component and renderer has to be handed to `use()` before an option mentioning it will
 * draw. Importing the `echarts` barrel instead would register all of them — roughly a
 * megabyte of chart types this dashboard does not have — and defeat the code splitting
 * `vite.config.js` sets up for the ECharts chunk. So the registration happens once, here,
 * and no other file in the dashboard calls `use()`.
 *
 * Adding a chart type is therefore a two-line change in this file plus the component.
 * Forgetting the line shows up as an ECharts console error naming the missing type.
 *
 * `echarts-wordcloud` is a side-effect import: it registers its own series and view
 * against the same core, so it has to come after the core import, and it exports nothing
 * worth naming.
 */

import { use, init, graphic } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import {
  BarChart,
  CustomChart,
  HeatmapChart,
  LineChart,
  PieChart,
  SankeyChart,
  TreeChart,
} from 'echarts/charts';
import {
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import 'echarts-wordcloud';

use([
  // The renderer. SVG rather than canvas: these charts are mostly text and thin marks,
  // they are printed and screenshotted into briefs, and an SVG stays sharp when they are.
  SVGRenderer,

  // Series types, one per component under this directory.
  BarChart, // Bar, GroupedBar, StackedBar, Histogram
  CustomChart, // Timeline lanes, Heatmap's inferred-cell hatch
  HeatmapChart, // Heatmap
  LineChart, // Line (and the empty carrier series that holds its annotations)
  PieChart, // Donut
  SankeyChart, // Sankey
  TreeChart, // Tree

  // Components.
  GraphicComponent, // the total in the Donut's hole
  GridComponent,
  LegendComponent,
  MarkAreaComponent, // weekend bands
  MarkLineComponent, // public holidays, the Timeline's deadline
  TooltipComponent,
  VisualMapComponent, // the Heatmap's sequential ramp
]);

export { init, graphic };
