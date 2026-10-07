/**
 * The element a chart is drawn into.
 *
 * Every chart component in this directory renders one of these when it is showing its
 * chart, and its table twin when it is not. Keeping the hook in here rather than in each
 * chart is what lets a chart component switch between the two views with a plain
 * conditional: a component that called `useChart` and then returned a table would be
 * calling a hook conditionally, and Preact would tear on the first toggle. `Plot`
 * unmounting on the way to the table view is also what disposes the ECharts instance, so
 * a card left on Table is not holding a chart open behind it.
 *
 * The container is `role="img"`: what is inside it is a picture, and the table twin — one
 * click away, in the same card — is the equivalent a screen reader gets.
 */

import { useChart } from './useChart.js';

/**
 * A sized container with a live ECharts instance in it.
 * @param {{build: function(!Object, number): !Object, height: number, label: string}} props
 *     `build` returns the ECharts option, given the palette and the current pixel width;
 *     `height` is the container height in pixels, sized to include the axis band so the
 *     card never grows a nested scrollbar; `label` describes the chart for a screen
 *     reader that will not be shown the marks.
 * @returns {!Object} The container element.
 */
export function Plot({ build, height, label }) {
  const container = useChart(build);
  return (
    <div
      ref={container}
      role="img"
      aria-label={label}
      style={{ width: '100%', height: height + 'px' }}
    />
  );
}
