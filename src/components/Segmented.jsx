/**
 * The one segmented control in the dashboard.
 *
 * There were four copies of this markup — the Battalion/Companies scope switch, the
 * granularity radio, the chart/table view toggle, and the quick-range preset row — each
 * rendering the same `.toggle` wrapper around the same `.button--toggle` children with
 * its own hand-written ARIA. They are the same control with different options in it, so
 * a caller now supplies the options and the label and nothing else.
 *
 * `radio` picks the accessibility semantics. A radiogroup is for choosing one of several
 * mutually exclusive values (the granularity); a group of toggle buttons is for switches
 * that happen to sit together. The distinction matters to a screen reader, and getting
 * it wrong is what produced the previous version's granularity control carrying both
 * `aria-checked` and `aria-pressed` at once.
 */

/**
 * The scope switch's options, shared by Overview and the three category pages.
 * @type {Array<{name: string, label: string}>}
 */
export const SCOPE_OPTIONS = [
  { name: 'battalion', label: 'Battalion' },
  { name: 'companies', label: 'Companies' },
];

/**
 * The chart/table view switch's options.
 * @type {Array<{name: string, label: string}>}
 */
export const VIEW_OPTIONS = [
  { name: 'chart', label: 'Chart' },
  { name: 'table', label: 'Table' },
];

/**
 * A row of mutually exclusive buttons.
 * @param {{options: Array<{name: string, label: string}>, value: ?string,
 *     onChange: function(string): void, label: string, radio: (boolean|undefined)}} props
 *     The options in display order; the selected option's name, or null when none is
 *     selected; the change callback; the group's accessible name; and whether to use
 *     radiogroup semantics rather than toggle-button semantics.
 * @returns {!preact.VNode} The control.
 */
export function Segmented({ options, value, onChange, label, radio }) {
  return (
    <div class="toggle" role={radio ? 'radiogroup' : 'group'} aria-label={label}>
      {options.map((option) => {
        const selected = value === option.name;
        return (
          <button
            key={option.name}
            type="button"
            class="button button--toggle"
            role={radio ? 'radio' : undefined}
            aria-checked={radio ? selected : undefined}
            aria-pressed={radio ? undefined : selected}
            onClick={() => onChange(option.name)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
