/**
 * The bridge from `theme/tokens.css` to ECharts, which needs colour strings. The only place in the chart
 * layer that names a colour, by token name. `readPalette()` runs on every paint so a theme change re-tints.
 */

import type { EChartsCoreOption } from 'echarts/core';

/** An ECharts option or option fragment. */
export type ChartOption = EChartsCoreOption;

/** Whether the viewer asked for less animation, read at paint time so a changed OS setting applies. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** One custom property off the root, trimmed. */
function token(styles: CSSStyleDeclaration, property: string): string {
  return (styles.getPropertyValue(property) || '').trim();
}

/** A numbered token family, e.g. `--series-1` to `--series-6`. */
function ramp(styles: CSSStyleDeclaration, prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => token(styles, prefix + (index + 1)));
}

/** The token set as it is right now; call at paint time, never cache. */
export function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  return {
    surface: token(styles, '--surface'),
    canvasSunken: token(styles, '--canvas-sunken'),
    ink: token(styles, '--ink'),
    inkMuted: token(styles, '--ink-muted'),
    inkFaint: token(styles, '--ink-faint'),
    hairline: token(styles, '--hairline'),
    hairlineSoft: token(styles, '--hairline-soft'),
    accent: token(styles, '--accent'),
    /** Categorical (Okabe-Ito), in `COMPANIES` order. */
    series: ramp(styles, '--series-', 6),
    /** Sequential, low to high; heatmaps only. */
    seq: ramp(styles, '--seq-', 5),
    /** Semantic standings, never categories. */
    good: token(styles, '--good'),
    warning: token(styles, '--warning'),
    serious: token(styles, '--serious'),
    critical: token(styles, '--critical'),
    weekendBand: token(styles, '--weekend-band'),
    holidayLine: token(styles, '--holiday-line'),
    inferred: token(styles, '--inferred'),
    fontUi: token(styles, '--font-ui'),
    fontDisplay: token(styles, '--font-display'),
    radiusMd: token(styles, '--radius-md'),
  };
}

/** The resolved design tokens. */
export type Palette = ReturnType<typeof readPalette>;

/** A reading's standing; charts take the name, so a category cannot pass as a standing. */
export type Standing = 'good' | 'warning' | 'serious' | 'critical';

const STANDINGS: readonly string[] = ['good', 'warning', 'serious', 'critical'];

/** The semantic colour for a standing, or null when none or unknown. */
export function standingColor(palette: Palette, standing: string | null | undefined): string | null {
  return standing && STANDINGS.includes(standing) ? palette[standing as Standing] : null;
}

/** The categorical colour for a slot; a slot is an identity (`companyIndex`), so Archer is one blue everywhere. */
export function seriesColor(palette: Palette, slot: number): string {
  const count = palette.series.length;
  return palette.series[((slot % count) + count) % count]!;
}

/** The fragment every chart starts from: transparent background, type, motion, grid and tooltip chrome. */
export function baseOption(palette: Palette) {
  const still = prefersReducedMotion();
  return {
    // The card already paints `--surface`; painting it again would break on a raised surface.
    backgroundColor: 'transparent',
    animation: !still,
    animationDuration: still ? 0 : 320,
    animationDurationUpdate: still ? 0 : 240,
    textStyle: { fontFamily: palette.fontUi, color: palette.inkMuted, fontSize: 12 },
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      // Confined, so a tooltip near the right edge does not push the page sideways.
      confine: true,
      backgroundColor: palette.surface,
      borderColor: palette.hairline,
      borderWidth: 1,
      padding: 10,
      extraCssText: `border-radius:${palette.radiusMd};box-shadow:none;`,
      textStyle: { color: palette.ink, fontSize: 12, fontFamily: palette.fontUi },
    },
  };
}

/** Axis chrome: solid hairlines (a dashed rule reads as a threshold), no ticks. */
export function axisOption(palette: Palette, extra: ChartOption = {}): ChartOption {
  return {
    axisLine: { lineStyle: { color: palette.hairline } },
    axisTick: { show: false },
    axisLabel: { color: palette.inkMuted, fontSize: 11, fontFamily: palette.fontUi },
    splitLine: { lineStyle: { color: palette.hairlineSoft, type: 'solid' } },
    ...extra,
  };
}

/** A value axis with its unit aligned inward so the name is never clipped (ECharts centres it on the line). */
export function valueAxisOption(palette: Palette, name?: string, vertical = false): ChartOption {
  return axisOption(palette, {
    type: 'value',
    name: name || undefined,
    // Under a horizontal axis, not at its end, where it reads as part of the last tick.
    nameLocation: vertical ? 'end' : 'middle',
    nameGap: vertical ? 6 : 24,
    nameTextStyle: { color: palette.inkMuted, fontSize: 11, align: vertical ? 'left' : 'center' },
  });
}

/** Grid padding with room for a unit label under the x-axis (`containLabel` leaves none). */
export function gridOption(palette: Palette, hasBottomName: boolean, extra: ChartOption = {}): ChartOption {
  const grid = baseOption(palette).grid;
  return { ...grid, bottom: hasBottomName ? 26 : grid.bottom, ...extra };
}

/** A toggling legend in muted ink (a light hue is illegible as text), shown for two or more series. */
export function legendOption(palette: Palette, names: string[], extra: ChartOption = {}): ChartOption {
  return {
    show: names.length > 1,
    data: names,
    // Right-aligned so it never lands on a y-axis name, which sits top-left.
    top: 0,
    right: 0,
    itemWidth: 10,
    itemHeight: 10,
    itemGap: 14,
    icon: 'roundRect',
    selectedMode: true,
    textStyle: { color: palette.inkMuted, fontSize: 12, fontFamily: palette.fontUi },
    inactiveColor: palette.inkFaint,
    ...extra,
  };
}
