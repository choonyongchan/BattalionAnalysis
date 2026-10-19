/**
 * The lifecycle every chart shares: dispose on unmount, repaint on a theme change, resize with its container
 * (the sidebar resizes it without a window resize), and re-lay out once fonts load (no clipped labels).
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ECharts } from 'echarts/core';
import { resolvedTheme } from '../theme/useTheme.ts';
import { init } from './echarts.ts';
import { readPalette, type ChartOption, type Palette } from './theme.ts';

/** Builds a chart's option from the palette and the container's pixel width. */
export type BuildOption = (palette: Palette, width: number) => ChartOption;

/** A ref for the chart container; the chart is painted from `build` on every render. */
export function useChart(build: BuildOption) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  // The latest `build`, so the paint effect never calls a stale closure.
  const builder = useRef(build);
  builder.current = build;

  // An explicit subscription: reading the signal during render stopped firing behind `cloneElement`.
  const [, forceRepaint] = useState(0);
  useEffect(() => resolvedTheme.subscribe(() => forceRepaint((tick) => tick + 1)), []);

  useEffect(() => {
    const node = container.current;
    if (!node) return undefined;
    const instance = init(node, null, { renderer: 'svg' });
    chart.current = instance;

    const observer = new ResizeObserver(() => {
      if (!instance.isDisposed()) instance.resize();
    });
    observer.observe(node);

    let unmounted = false;
    if (document.fonts && document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => {
        if (!unmounted && !instance.isDisposed()) instance.resize();
      });
    }

    return () => {
      unmounted = true;
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = chart.current;
    if (!instance || instance.isDisposed()) return;
    // `notMerge`: a re-tint must replace colours, and a removed series must leave the screen.
    instance.setOption(builder.current(readPalette(), instance.getWidth()), { notMerge: true });
  });

  return container;
}
