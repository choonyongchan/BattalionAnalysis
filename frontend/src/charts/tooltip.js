/**
 * Tooltips, built as DOM nodes rather than markup strings.
 *
 * This is not a style preference. An ECharts tooltip formatter that returns a string has
 * that string parsed as HTML, and every value a tooltip here shows — a company name, a
 * soldier's name, a free-text report-sick reason — reaches the dashboard from a WhatsApp
 * message a person typed. The previous implementation made the same call and said so at
 * its heatmap formatter; it is the one rule from it carried forward without
 * qualification.
 *
 * ECharts 5 accepts an `HTMLElement` back from a formatter, so the fix costs nothing:
 * build the node, set `textContent`, hand it over. There is no `innerHTML` in this file
 * and there should never be one in this directory.
 */

/**
 * Creates a positioned element with inline layout styles.
 * @param {string} tag Tag name.
 * @param {!Object<string, string>=} styles Inline styles to apply.
 * @param {string=} text Text content, inserted as text.
 * @returns {!HTMLElement} The element.
 */
function node_(tag, styles, text) {
  const element = document.createElement(tag);
  Object.assign(element.style, styles || {});
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

/**
 * A small round swatch carrying a series colour.
 *
 * Identity in a tooltip travels on this mark, never on the text beside it: a light
 * categorical hue set as text colour fails contrast on both surfaces.
 * @param {string} color A colour resolved from a token.
 * @returns {!HTMLElement} The swatch.
 */
function swatch_(color) {
  return node_('span', {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '2px',
    marginRight: '7px',
    flex: '0 0 auto',
    background: color,
  });
}

/**
 * Builds a tooltip: a heading, then one row per value.
 * @param {?string} title The heading, usually the hovered category. Omitted when null.
 * @param {Array<{label: string, value: string, color: (string|undefined),
 *     muted: (boolean|undefined)}>} rows One row per value; `color` draws a swatch,
 *     `muted` dims the row for an absence rather than a reading.
 * @param {!Object} palette A palette from `readPalette`, for the text colours.
 * @returns {!HTMLElement} The tooltip body.
 */
export function tooltipNode(title, rows, palette) {
  const box = node_('div', { minWidth: '110px', lineHeight: '1.45' });
  if (title) {
    box.appendChild(
      node_(
        'div',
        { fontWeight: '600', color: palette.ink, marginBottom: rows.length ? '5px' : '0' },
        title
      )
    );
  }
  rows.forEach((row) => {
    const line = node_('div', {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      justifyContent: 'space-between',
      color: row.muted ? palette.inkFaint : palette.inkMuted,
    });
    const left = node_('span', { display: 'flex', alignItems: 'center', minWidth: '0' });
    if (row.color) {
      left.appendChild(swatch_(row.color));
    }
    left.appendChild(node_('span', {}, row.label));
    line.appendChild(left);
    line.appendChild(
      node_(
        'span',
        {
          fontWeight: '600',
          color: row.muted ? palette.inkFaint : palette.ink,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        },
        row.value
      )
    );
    box.appendChild(line);
  });
  return box;
}

/**
 * Builds a tooltip that is a heading and one or more plain lines.
 *
 * For the charts whose hovered mark is one thing — a Sankey node, a tree node, a word —
 * where a label/value table would be a grid of one column.
 * @param {?string} title The heading.
 * @param {string[]} lines Supporting lines, in order.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!HTMLElement} The tooltip body.
 */
export function tooltipLines(title, lines, palette) {
  const box = node_('div', { minWidth: '90px', lineHeight: '1.45', maxWidth: '260px' });
  if (title) {
    box.appendChild(
      node_('div', { fontWeight: '600', color: palette.ink, marginBottom: '3px' }, title)
    );
  }
  lines
    .filter((line) => line)
    .forEach((line) => {
      box.appendChild(node_('div', { color: palette.inkMuted, whiteSpace: 'normal' }, line));
    });
  return box;
}
