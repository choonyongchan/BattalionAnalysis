/**
 * The one place ECharts is assembled: `echarts/core` is empty, and each chart type, component and
 * renderer is registered here (the barrel would pull in ~1 MB). A missing line shows as a console error.
 */

import { use, init } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import {
  BarChart,
  CustomChart,
  HeatmapChart,
  LineChart,
  PieChart,
  SankeyChart,
  ScatterChart,
} from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';

use([
  // The renderer. SVG rather than canvas: these charts are mostly text and thin marks,
  // they are printed and screenshotted into briefs, and an SVG stays sharp when they are.
  SVGRenderer,

  // Series types, one per component under this directory.
  BarChart, // Bar
  CustomChart, // Heatmap's inferred-cell hatch
  HeatmapChart, // Heatmap
  LineChart, // Line (and the empty carrier series that holds its annotations)
  PieChart, // Donut
  SankeyChart, // Sankey
  ScatterChart, // Scatter

  // Components.
  GridComponent,
  LegendComponent,
  MarkAreaComponent, // weekend bands
  MarkLineComponent, // public holidays
  TooltipComponent,
  VisualMapComponent, // the Heatmap's sequential ramp
]);

export { init };
