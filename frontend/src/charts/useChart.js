/**
 * The lifecycle every chart component shares: mount, re-paint, re-tint, resize, dispose.
 *
 * Four things go wrong with an ECharts instance inside a component tree, and this hook
 * exists to make each of them impossible rather than remembered:
 *
 * - **The leak.** An instance not disposed on unmount keeps its DOM, its data and its
 *   listeners alive. Seven pages navigated back and forth all morning is how a dashboard
 *   that opened fast ends the day at a crawl. The cleanup here disposes unconditionally.
 * - **The stale tint.** ECharts holds colour *values*, so a theme change re-cascades the
 *   CSS and leaves the chart painted in the old palette unless something re-applies it.
 *   An earlier version of this hook read `resolvedTheme.value` during render to lean on
 *   `@preact/signals`' automatic component tracking; that fired once, on the first
 *   toggle, and then stopped — the specific failure mode a bare `signal.value;`
 *   expression statement is prone to once a component sits behind `ChartCard`'s
 *   `cloneElement`. An explicit `resolvedTheme.subscribe` in an effect has no such
 *   subtlety: it calls back on every change, for the life of the effect, full stop.
 * - **The wrong size.** The sidebar collapsing changes a chart's container without
 *   changing the window, so a window `resize` listener — what the old implementation
 *   used — misses it and the chart keeps the old width. A `ResizeObserver` on the container
 *   itself sees every case, including the one the old code got wrong.
 * - **The clipped axis label.** ECharts reserves the axis gutter by measuring labels at
 *   `setOption` time. Measured against a fallback font, the real face overflows the space
 *   reserved for it and long category labels lose their first characters. Carried forward
 *   from the previous implementation: re-lay out once the fonts land.
 *
 * The option is rebuilt on every render rather than behind a dependency array. A chart
 * only re-renders when its props or the theme changed, so the dependency array would be a
 * second, hand-maintained copy of that same fact — and a hand-maintained copy is exactly
 * where a chart showing last week's data comes from.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { resolvedTheme } from '../theme/useTheme.js';
import { init } from './echarts.js';
import { readPalette } from './theme.js';

/**
 * Mounts an ECharts instance on a ref'd element and keeps it correct.
 * @param {function(!Object, number): !Object} build Builds the ECharts option. Called with
 *     the palette read fresh from the tokens, and the instance's current pixel width — a
 *     couple of charts lay out differently in a narrow card.
 * @returns {!Object} A ref to attach to the container element.
 */
export function useChart(build) {
  /** @type {!Object} The container element. */
  const container = useRef(null);
  /** @type {!Object} The live ECharts instance, or null between mount and unmount. */
  const chart = useRef(null);
  /** @type {!Object} The latest `build`, so the paint effect never calls a stale closure. */
  const builder = useRef(build);
  builder.current = build;

  // Forces a re-render on every theme change, for the life of this component — see the
  // file header for why this replaced reading `resolvedTheme.value` during render.
  const [, forceRepaint] = useState(0);
  useEffect(() => resolvedTheme.subscribe(() => forceRepaint((tick) => tick + 1)), []);

  useEffect(() => {
    const node = container.current;
    if (!node) {
      return undefined;
    }
    const instance = init(node, null, { renderer: 'svg' });
    chart.current = instance;

    const observer = new ResizeObserver(() => {
      if (!instance.isDisposed()) {
        instance.resize();
      }
    });
    observer.observe(node);

    let unmounted = false;
    if (document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(() => {
        if (!unmounted && !instance.isDisposed()) {
          instance.resize();
        }
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
    if (!instance || instance.isDisposed()) {
      return;
    }
    // `notMerge` because a re-tint replaces colours that ECharts would otherwise keep from
    // the previous option, and because a data change can remove a series entirely — a
    // merged option would leave the dropped series on screen.
    instance.setOption(builder.current(readPalette(), instance.getWidth()), { notMerge: true });
  });

  return container;
}
