/**
 * The bridge between `theme/tokens.css` and an ECharts option.
 *
 * ECharts cannot read a CSS custom property — it wants a colour string — so something has
 * to resolve `var(--series-1)` into a value. That resolution is the only place in the
 * chart layer allowed to name a colour, and it names them as token *names*, never as
 * values. A hex written into a chart file is the specific defect this arrangement exists
 * to prevent: the card re-tints on a theme change because CSS re-cascades, and the chart,
 * holding a value it copied down once, silently does not.
 *
 * Hence `readPalette()` is a function and not a constant. The previous implementation
 * cached the palette at module load (`const COLOR = readPalette_()`),
 * which was correct only because that dashboard had a single theme. Here the palette is
 * re-read on every paint, and `useChart.js` re-paints whenever `resolvedTheme` changes.
 *
 * Nothing in this file holds state. It is a reader and a set of option fragments.
 */

/**
 * Whether the viewer has asked for less animation.
 *
 * Read at option-build time rather than once at load, so a viewer who changes the OS
 * setting with the dashboard open gets the new behaviour on the next paint.
 * @returns {boolean} True when animation should be suppressed.
 */
export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Resolves one custom property off the document root.
 * @param {!CSSStyleDeclaration} styles Computed styles of the root element.
 * @param {string} property A custom property name, including the leading dashes.
 * @returns {string} The declared value, trimmed.
 */
function token_(styles, property) {
  return (styles.getPropertyValue(property) || '').trim();
}

/**
 * Resolves a numbered family of custom properties, e.g. `--series-1` through `--series-6`.
 * @param {!CSSStyleDeclaration} styles Computed styles of the root element.
 * @param {string} prefix The property name without its trailing index.
 * @param {number} count How many steps the family has.
 * @returns {string[]} The values, in index order.
 */
function ramp_(styles, prefix, count) {
  return Array.from({ length: count }, (_, index) => token_(styles, prefix + (index + 1)));
}

/**
 * Reads the whole token set off `document.documentElement` as it is right now.
 *
 * Call this at paint time. Caching the result is the bug described in the file header.
 * @returns {!Object} The palette: colours, fonts and the radius a tooltip uses.
 */
export function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  return {
    surface: token_(styles, '--surface'),
    canvasSunken: token_(styles, '--canvas-sunken'),
    ink: token_(styles, '--ink'),
    inkMuted: token_(styles, '--ink-muted'),
    inkFaint: token_(styles, '--ink-faint'),
    hairline: token_(styles, '--hairline'),
    hairlineSoft: token_(styles, '--hairline-soft'),
    accent: token_(styles, '--accent'),
    /** Categorical, Okabe-Ito, in `domain.js`'s COMPANIES order. */
    series: ramp_(styles, '--series-', 6),
    /** Sequential, low to high. Heatmaps only. */
    seq: ramp_(styles, '--seq-', 5),
    /** Semantic. A reading's standing, never a category. */
    good: token_(styles, '--good'),
    warning: token_(styles, '--warning'),
    serious: token_(styles, '--serious'),
    critical: token_(styles, '--critical'),
    weekendBand: token_(styles, '--weekend-band'),
    holidayLine: token_(styles, '--holiday-line'),
    inferred: token_(styles, '--inferred'),
    fontUi: token_(styles, '--font-ui'),
    fontDisplay: token_(styles, '--font-display'),
    radiusMd: token_(styles, '--radius-md'),
  };
}

/**
 * The semantic colour for a named standing.
 *
 * Charts take a standing *name* rather than a colour, so a caller cannot smuggle a
 * category into the semantic ramp by handing over a value.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {?string} standing 'good' | 'warning' | 'serious' | 'critical', or null.
 * @returns {?string} The colour, or null when the standing is unnamed or unknown.
 */
export function standingColor(palette, standing) {
  return STANDINGS.includes(standing) ? palette[standing] : null;
}

/** @type {string[]} The only palette keys a caller may reach through `standingColor`. */
const STANDINGS = ['good', 'warning', 'serious', 'critical'];

/**
 * The categorical colour for a series slot.
 *
 * A slot is an *identity*, not a position: a page draws company N with slot
 * `COMPANIES.indexOf(name)` so Archer is the same blue on every chart in the dashboard,
 * and filtering a company out never repaints the survivors.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {number} slot Zero-based slot; wraps at six, which only happens if a caller
 *     exceeds the ramp and should have folded its tail into an "Other".
 * @returns {string} The colour.
 */
export function seriesColor(palette, slot) {
  return palette.series[((slot % palette.series.length) + palette.series.length) % palette.series.length];
}

/**
 * The option fragment every chart starts from.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} Background, type, animation, grid and tooltip chrome.
 */
export function baseOption(palette) {
  const still = prefersReducedMotion();
  return {
    // The card behind the chart already carries `--surface`; painting it again here would
    // hard-code the card's background into the chart and break on a raised surface.
    backgroundColor: 'transparent',
    animation: !still,
    animationDuration: still ? 0 : 320,
    animationDurationUpdate: still ? 0 : 240,
    textStyle: { fontFamily: palette.fontUi, color: palette.inkMuted, fontSize: 12 },
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      // Confined to the chart's box: an unconfined tooltip near the right edge of a card
      // pushes the page sideways.
      confine: true,
      backgroundColor: palette.surface,
      borderColor: palette.hairline,
      borderWidth: 1,
      padding: 10,
      extraCssText: 'border-radius:' + palette.radiusMd + ';box-shadow:none;',
      textStyle: { color: palette.ink, fontSize: 12, fontFamily: palette.fontUi },
    },
  };
}

/**
 * Axis chrome: hairline, solid, recessive.
 *
 * Solid rather than dashed on purpose — a dashed rule reads as a threshold or a
 * projection, and a gridline is neither.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {!Object=} extra Axis properties merged over the defaults.
 * @returns {!Object} An axis option.
 */
export function axisOption(palette, extra) {
  return {
    axisLine: { lineStyle: { color: palette.hairline } },
    axisTick: { show: false },
    axisLabel: { color: palette.inkMuted, fontSize: 11, fontFamily: palette.fontUi },
    splitLine: { lineStyle: { color: palette.hairlineSoft, type: 'solid' } },
    ...extra,
  };
}

/**
 * A value axis carrying its unit, positioned so the unit is never clipped.
 *
 * ECharts centres an axis name on the axis line, which puts about half of it outside the
 * SVG: a vertical axis's name overhangs the left edge, a horizontal one's overhangs the
 * right, and the browser clips both. Aligning the text toward the inside of the plot is
 * what keeps it whole. Carried forward from the previous implementation, where it was
 * found the hard way.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {string=} name The unit shown at the end of the axis.
 * @param {boolean=} vertical Whether the axis runs up the page.
 * @returns {!Object} An axis option.
 */
export function valueAxisOption(palette, name, vertical) {
  return axisOption(palette, {
    type: 'value',
    name: name || undefined,
    // A horizontal axis takes its unit centred underneath rather than at the end: at the
    // end it lands directly above the last tick and reads as part of that number.
    nameLocation: vertical ? 'end' : 'middle',
    nameGap: vertical ? 6 : 24,
    nameTextStyle: {
      color: palette.inkMuted,
      fontSize: 11,
      align: vertical ? 'left' : 'center',
    },
  });
}

/**
 * Grid padding that leaves room for a unit label under a horizontal value axis.
 *
 * `containLabel` reserves space for tick labels but not for the axis name, so a name
 * placed beneath the axis falls outside the SVG and is clipped.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {boolean} hasBottomName Whether a name will be drawn under the x-axis.
 * @param {!Object=} extra Grid properties merged over the defaults.
 * @returns {!Object} A grid option.
 */
export function gridOption(palette, hasBottomName, extra) {
  const grid = baseOption(palette).grid;
  return { ...grid, bottom: hasBottomName ? 26 : grid.bottom, ...extra };
}

/**
 * A legend that toggles its series, in text colours rather than series colours.
 *
 * Present whenever there are two or more series: identity must never rest on a reader
 * matching hues from memory. The swatch beside each name carries the colour; the name
 * itself stays in muted ink, because a light categorical hue is illegible as text.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {string[]} names The series that belong in the legend. Carrier series holding
 *     annotations are deliberately left out.
 * @param {!Object=} extra Legend properties merged over the defaults.
 * @returns {!Object} A legend option.
 */
export function legendOption(palette, names, extra) {
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
