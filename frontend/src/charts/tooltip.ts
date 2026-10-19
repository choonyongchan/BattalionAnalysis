/**
 * Tooltips built as DOM nodes with `textContent`, never HTML strings: names and reasons come from typed
 * messages, and an ECharts string formatter is parsed as HTML. No `innerHTML` in this directory.
 */

import type { Palette } from './theme.ts';

/** One line of a tooltip: a label and its value, with an optional series swatch. */
export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
  /** Fainter, for a figure that is context rather than the reading. */
  muted?: boolean;
}

/** An element with inline styles and optional text, inserted as text. */
function node(tag: string, styles: Partial<CSSStyleDeclaration> = {}, text?: string): HTMLElement {
  const element = document.createElement(tag);
  Object.assign(element.style, styles);
  if (text !== undefined) element.textContent = text;
  return element;
}

/** A small swatch carrying a series colour (identity travels on the mark, never as text colour). */
function swatch(color: string): HTMLElement {
  return node('span', {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '2px',
    marginRight: '7px',
    flex: '0 0 auto',
    background: color,
  });
}

/** A titled tooltip of label/value rows. */
export function tooltipNode(title: string, rows: TooltipRow[], palette: Palette): HTMLElement {
  const box = node('div', { minWidth: '110px', lineHeight: '1.45' });
  if (title) {
    box.appendChild(node('div', { fontWeight: '600', color: palette.ink, marginBottom: rows.length ? '5px' : '0' }, title));
  }
  for (const row of rows) {
    const line = node('div', {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      justifyContent: 'space-between',
      color: row.muted ? palette.inkFaint : palette.inkMuted,
    });
    const left = node('span', { display: 'flex', alignItems: 'center', minWidth: '0' });
    if (row.color) left.appendChild(swatch(row.color));
    left.appendChild(node('span', {}, row.label));
    line.appendChild(left);
    line.appendChild(
      node(
        'span',
        { fontWeight: '600', color: row.muted ? palette.inkFaint : palette.ink, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
        row.value,
      ),
    );
    box.appendChild(line);
  }
  return box;
}

/** A titled tooltip of free-text lines (blank lines dropped). */
export function tooltipLines(title: string, lines: (string | null | undefined | false)[], palette: Palette): HTMLElement {
  const box = node('div', { minWidth: '90px', lineHeight: '1.45', maxWidth: '260px' });
  if (title) box.appendChild(node('div', { fontWeight: '600', color: palette.ink, marginBottom: '3px' }, title));
  for (const line of lines) {
    if (line) box.appendChild(node('div', { color: palette.inkMuted, whiteSpace: 'normal' }, line));
  }
  return box;
}
