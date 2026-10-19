/** The stat tile row at the top of every page. */

import type { ComponentChildren } from 'preact';

/** One tile: a label, a figure already formatted through `format.ts`, and an optional caveat. */
export function Tile({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return (
    <div class="tile">
      <span class="tile__label">{label}</span>
      <span class="tile__value num">{value}</span>
      {foot ? <span class="tile__foot">{foot}</span> : null}
    </div>
  );
}

/** The row of tiles. */
export function TileRow({ children }: { children: ComponentChildren }) {
  return <div class="tilerow">{children}</div>;
}
