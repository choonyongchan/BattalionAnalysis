/**
 * What soldiers actually wrote, from the free-text half of the report-sick form.
 *
 * `model/symptoms.js` makes the case for keeping this beside the clean pick-list chart
 * rather than letting the pick-list stand in for it: the free text "is how a soldier
 * described it in their own words, which is worth reading precisely because it is not one
 * of eight options". A cloud is the right form for that and the wrong form for almost
 * anything else — it is a *reading* surface, not a measuring one, and the ranked counts
 * live in the table twin one click away.
 *
 * Two decisions that keep it from being the usual mess:
 *
 * - **Nothing is rotated.** A cloud with words turned 90° looks busier and reads worse; the
 *   only thing rotation buys is packing density, which is not a value to the reader.
 * - **Colour carries magnitude, not identity.** The words have no categories, so a
 *   categorical ramp here would assign six meaningless hues. The sequential ramp's upper
 *   steps carry the count instead, which is the one thing colour can honestly say — and
 *   because `--seq-5` is the step furthest from the surface in *both* themes, the most
 *   frequent words are also the most legible ones in both.
 *
 * This is the one chart where the marks are the untrusted text itself. ECharts renders a
 * word-cloud item as SVG text, so a reason typed into WhatsApp is never parsed as markup,
 * and the tooltip goes through the DOM builder like every other tooltip here.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { fmtInt } from '../format.js';
import { tooltipLines } from './tooltip.js';
import { baseOption, prefersReducedMotion } from './theme.js';

/** @type {Array<number>} The `--seq` steps used, low to high; 1 and 2 fail contrast as text. */
const RAMP_STEPS = [2, 3, 4];

/** @type {Array<number>} Smallest and largest word size, in pixels. */
const SIZE_RANGE = [13, 46];

/**
 * The ramp step a word's count falls in.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {number} count The word's count.
 * @param {number} min The smallest count in the set.
 * @param {number} max The largest count in the set.
 * @returns {string} A colour resolved from a `--seq` token.
 */
function rampColor_(palette, count, min, max) {
  const share = max > min ? (count - min) / (max - min) : 1;
  const step = RAMP_STEPS[Math.min(RAMP_STEPS.length - 1, Math.floor(share * RAMP_STEPS.length))];
  return palette.seq[step];
}

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} The option.
 */
function option_(props, palette) {
  const { words } = props;
  const counts = words.map((word) => word.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const base = baseOption(palette);

  return {
    ...base,
    grid: undefined,
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      formatter: (params) =>
        tooltipLines(
          params.name,
          [fmtInt(params.value) + (params.value === 1 ? ' mention' : ' mentions')],
          palette
        ),
    },
    series: [
      {
        type: 'wordCloud',
        shape: 'circle',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        sizeRange: SIZE_RANGE,
        // Flat, always. See the file header.
        rotationRange: [0, 0],
        gridSize: 8,
        // Words that will not fit are dropped rather than shrunk past legibility; the table
        // twin still carries every one of them.
        drawOutOfBound: false,
        shrinkToFit: true,
        layoutAnimation: !prefersReducedMotion(),
        textStyle: { fontFamily: palette.fontUi, fontWeight: 600 },
        emphasis: { textStyle: { color: palette.accent } },
        data: words.map((word) => ({
          name: word.word,
          value: word.count,
          textStyle: { color: rampColor_(palette, word.count, min, max) },
        })),
      },
    ],
  };
}

/**
 * A word cloud of free-text report-sick reasons.
 * @param {{words: Array<{word: string, count: number}>, height: (number|undefined),
 *     view: (string|undefined)}} props
 *     `words` is `model/symptoms.js`'s `reasonKeywords` output, already ranked and capped —
 *     this component does not cap it, because how many keywords are worth showing is a
 *     question about the corpus and not about the chart; `view` is set by `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function WordCloud(props) {
  const { words, height = 320, view } = props;
  if (view === 'table') {
    return (
      <TableTwin
        columns={[{ label: 'Word' }, { label: 'Mentions', numeric: true }]}
        rows={words.map((word) => [word.word, fmtInt(word.count)])}
        caption="Free-text report-sick keywords by number of mentions"
      />
    );
  }
  return (
    <Plot
      height={height}
      label={
        words.length + ' free-text keywords, sized by mentions. Switch to Table for the counts.'
      }
      build={(palette) => option_(props, palette)}
    />
  );
}

/**
 * Whether there is anything to draw.
 * @param {!Object} props The component's props.
 * @returns {boolean} True when the chart has nothing to show.
 */
WordCloud.isEmpty = (props) => !props.words || props.words.length === 0;
