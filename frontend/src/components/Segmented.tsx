/**
 * The one segmented control: scope switch, granularity, chart/table view and range presets.
 * `radio` gives radiogroup semantics (one of several values) instead of toggle buttons.
 */

/** One option: its value and what it reads. */
export interface Option<N extends string = string> {
  name: N;
  label: string;
}

/** The Battalion/Companies scope switch. */
export const SCOPE_OPTIONS = [
  { name: 'battalion', label: 'Battalion' },
  { name: 'companies', label: 'Companies' },
] as const;

export type Scope = (typeof SCOPE_OPTIONS)[number]['name'];

/** The chart/table view switch. */
export const VIEW_OPTIONS = [
  { name: 'chart', label: 'Chart' },
  { name: 'table', label: 'Table' },
] as const;

export type View = (typeof VIEW_OPTIONS)[number]['name'];

/** A row of mutually exclusive buttons; `value` null selects none. */
export function Segmented<N extends string>({
  options,
  value,
  onChange,
  label,
  radio = false,
}: {
  options: readonly Option<N>[];
  value: N | null;
  onChange: (name: N) => void;
  label: string;
  radio?: boolean;
}) {
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
