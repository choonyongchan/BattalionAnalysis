/**
 * The 4D-or-name combobox: type, see suggestions, pick one.
 *
 * Local UI state only (the typed text, whether the list is open, which row is
 * highlighted). Which soldier is selected is reported to the caller, exactly as
 * `DateRangePicker` reports only the committed range.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { findSoldier } from '../model/soldier.js';

/**
 * A search box over a soldier index, with a live suggestion list.
 * @param {{index: Array<!Object>, placeholder?: string,
 *     onSelect: function(!Object): void}} props The result of `soldierIndex`, the input
 *     placeholder, and what to call with the chosen soldier.
 * @returns {!preact.VNode} The combobox.
 */
export function SoldierSearch({ index, placeholder, onSelect }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);

  const results = open ? findSoldier(index, query).slice(0, 8) : [];

  useEffect(() => {
    /**
     * Closes the suggestion list on an outside click.
     * @param {!Event} event The document mousedown.
     * @returns {void}
     */
    function onDocMouseDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  /**
   * Commits a suggestion: closes the list and reports the soldier.
   * @param {!Object} soldier A row from `soldierIndex`.
   * @returns {void}
   */
  function choose(soldier) {
    setQuery(soldier.name || soldier.fourD);
    setOpen(false);
    onSelect(soldier);
  }

  /**
   * Moves the highlighted row, or commits it on Enter.
   * @param {!KeyboardEvent} event The keydown.
   * @returns {void}
   */
  function onKeyDown(event) {
    if (!open || results.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[highlight]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div class="soldiersearch" ref={rootRef}>
      <input
        class="field field--pill soldiersearch__input"
        type="text"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-autocomplete="list"
        placeholder={placeholder || 'Type 4D or name to search for soldier'}
        value={query}
        onInput={(event) => {
          setQuery(event.currentTarget.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && results.length > 0 ? (
        <ul class="soldiersearch__list" role="listbox">
          {results.map((soldier, i) => (
            <li key={soldier.key}>
              <button
                type="button"
                class="soldiersearch__option"
                aria-selected={i === highlight}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(soldier)}
              >
                <span class="soldiersearch__name">{soldier.name || '(name not on record)'}</span>
                <span class="soldiersearch__meta">
                  {[soldier.fourD, soldier.company].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
