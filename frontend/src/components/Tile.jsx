/**
 * The stat tile row at the top of every page.
 */

/**
 * One tile: a label, a hero figure, and an optional caveat line beneath it.
 * @param {{label: string, value: string, foot?: string}} props The tile's contents.
 *     `value` is pre-formatted by the caller via `format.js` — a tile never formats its
 *     own number, so every figure in the dashboard goes through one formatter.
 * @returns {!preact.VNode} The tile.
 */
export function Tile({ label, value, foot }) {
  return (
    <div class="tile">
      <span class="tile__label">{label}</span>
      <span class="tile__value num">{value}</span>
      {foot ? <span class="tile__foot">{foot}</span> : null}
    </div>
  );
}

/**
 * The row of tiles itself.
 * @param {{children: *}} props The Tile elements.
 * @returns {!preact.VNode} The row.
 */
export function TileRow({ children }) {
  return <div class="tilerow">{children}</div>;
}
