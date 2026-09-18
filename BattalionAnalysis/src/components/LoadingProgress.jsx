/**
 * The bar shown while one slow request is in flight.
 *
 * The first read wakes an Apps Script deployment and pulls every tab of the spreadsheet
 * through it, which takes around half a minute. A disabled button and nothing else reads
 * as a hung page, so the wait is given a shape: a bar that keeps moving, a line of text
 * that changes, and an elapsed count next to the figure the wait is measured against.
 *
 * Two decisions here are deliberate and should survive a refactor:
 *
 * - **The progress is an estimate, and the bar never fills.** The feed is one POST with
 *   no progress events, so there is nothing real to report; the fill eases along
 *   `1 - e^(-t/tau)` toward a ceiling below 100%. A bar that reaches the end and then sits
 *   there is the exact failure this component exists to prevent, and it can only be
 *   avoided by never arriving. The bar disappears because the screen behind it changes,
 *   not because it finished.
 * - **The stage lines describe the request, not the server's position in it.** Nothing
 *   here can observe which part of the pipeline is running, so the lines say what is being
 *   waited on and roughly when, and never claim a step has completed.
 */

import { useEffect, useState } from 'preact/hooks';

/** @type {number} How often the bar and the elapsed count are recomputed, in ms. */
const TICK_MS = 250;

/** @type {number} The fraction the fill eases toward and never reaches. */
const CEILING = 0.92;

/**
 * Shapes the easing so the bar is ~90% of the way to the ceiling at the expected time.
 * @type {number}
 */
const EASE_SHAPE = 2.3;

/**
 * Counts seconds since the component mounted.
 *
 * The clock is read from `Date.now` rather than accumulated from the interval, because a
 * background tab throttles timers and an accumulated count would drift behind the wait it
 * is meant to describe.
 * @returns {number} Fractional seconds elapsed.
 */
function useElapsedSeconds() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setSeconds((Date.now() - startedAt) / 1000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return seconds;
}

/**
 * The share of the bar to fill after a given wait.
 * @param {number} seconds Seconds elapsed.
 * @param {number} expectedSeconds The wait this is measured against.
 * @returns {number} A fraction in [0, CEILING).
 */
function fillFraction(seconds, expectedSeconds) {
  return CEILING * (1 - Math.exp((-seconds * EASE_SHAPE) / expectedSeconds));
}

/**
 * The last stage whose start time has passed.
 * @param {!Array<{at: number, label: string}>} stages Stages in ascending `at` order.
 * @param {number} seconds Seconds elapsed.
 * @returns {string} The stage's label.
 */
function stageAt(stages, seconds) {
  let label = stages[0].label;
  stages.forEach((stage) => {
    if (seconds >= stage.at) {
      label = stage.label;
    }
  });
  return label;
}

/**
 * The line under the bar, which turns from a promise into an explanation once the
 * expected wait has passed. Saying "longer than usual" is what keeps a slow load from
 * reading as a broken one.
 * @param {number} seconds Seconds elapsed.
 * @param {number} expectedSeconds The wait this is measured against.
 * @returns {string} The elapsed line.
 */
function elapsedNote(seconds, expectedSeconds) {
  const whole = Math.floor(seconds);
  return seconds < expectedSeconds
    ? whole + 's · usually about ' + expectedSeconds + 's'
    : whole + 's · longer than usual, still waiting';
}

/**
 * Renders an easing progress bar with a changing stage line.
 * @param {{stages: !Array<{at: number, label: string}>, expectedSeconds: number,
 *   label: string}} props The stages to cycle, the expected wait in seconds, and the
 *   accessible name for the bar.
 * @returns {!preact.VNode} The bar.
 */
export function LoadingProgress({ stages, expectedSeconds, label }) {
  const seconds = useElapsedSeconds();
  const percent = fillFraction(seconds, expectedSeconds) * 100;
  const stage = stageAt(stages, seconds);

  return (
    <div class="loading">
      <div
        class="loading__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={stage}
      >
        <div class="loading__fill" style={{ width: percent.toFixed(1) + '%' }} />
      </div>

      <p class="loading__stage" role="status">
        {stage}
      </p>
      <p class="loading__elapsed">{elapsedNote(seconds, expectedSeconds)}</p>
    </div>
  );
}
