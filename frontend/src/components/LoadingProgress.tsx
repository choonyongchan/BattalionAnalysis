/**
 * The bar shown while one slow request is in flight (a cold Vercel function and Neon take seconds).
 * The fill is an estimate easing toward a ceiling it never reaches, since a bar that fills and sits there
 * reads as hung; the stage lines say what is being waited on, never that a step finished.
 */

import { useEffect, useState } from 'preact/hooks';

/** A line shown from `at` seconds into the wait. */
export interface Stage {
  at: number;
  label: string;
}

/** How often the bar and the elapsed count are recomputed, in ms. */
const TICK_MS = 250;

/** The fraction the fill eases toward and never reaches. */
const CEILING = 0.92;

/** Shapes the easing so the bar is ~90% of the way to the ceiling at the expected time. */
const EASE_SHAPE = 2.3;

/** Seconds since mount, from `Date.now` (a background tab throttles timers, so counting ticks drifts). */
function useElapsedSeconds(): number {
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

/** The share of the bar to fill after a wait, in [0, CEILING). */
function fillFraction(seconds: number, expectedSeconds: number): number {
  return CEILING * (1 - Math.exp((-seconds * EASE_SHAPE) / expectedSeconds));
}

/** The label of the last stage whose start time has passed. */
function stageAt(stages: Stage[], seconds: number): string {
  return stages.filter((stage) => seconds >= stage.at).pop()?.label ?? stages[0]?.label ?? '';
}

/** The elapsed line, which says "longer than usual" past the expected wait so slow never reads as broken. */
function elapsedNote(seconds: number, expectedSeconds: number): string {
  const whole = Math.floor(seconds);
  return seconds < expectedSeconds
    ? whole + 's · usually about ' + expectedSeconds + 's'
    : whole + 's · longer than usual, still waiting';
}

/** An easing progress bar with a changing stage line; `label` names the bar. */
export function LoadingProgress({ stages, expectedSeconds, label }: { stages: Stage[]; expectedSeconds: number; label: string }) {
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
