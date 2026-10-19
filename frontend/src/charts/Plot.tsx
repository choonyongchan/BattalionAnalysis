/**
 * The element a chart is drawn into. Keeping the hook here lets a chart switch to its table twin with a
 * plain conditional (no conditional hook), and unmounting disposes the ECharts instance. `role="img"`:
 * the table twin, one click away, is the screen-reader equivalent.
 */

import { useChart, type BuildOption } from './useChart.ts';

/** A container `height` px tall (axis band included) with a live chart; `label` describes it for screen readers. */
export function Plot({ build, height, label }: { build: BuildOption; height: number; label: string }) {
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
