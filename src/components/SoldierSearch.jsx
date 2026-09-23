/**
 * The 4D-or-name search bar: type, see suggestions, pick one.
 *
 * Shaped like a web search engine's one box: a magnifier leading the pill, a clear button
 * once something is typed, and the suggestion list growing out of the bar's lower edge
 * so the two read as one surface while it is open.
 *
 * Local UI state only (the typed text, whether the list is open, which row is
 * highlighted). Which soldier is selected is reported to the caller, exactly as
 * `DateRangePicker` reports only the committed range.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { ClearIcon, SearchIcon, SoldierIcon } from '../app/icons.jsx';
import { findSoldier } from '../model/soldier.js';

/**
 * A search bar over a soldier index, with a live suggestion list.
 * @param {{index: Array<!Object>, placeholder?: string, autoFocus?: boolean,
 *     onSelect: function(!Object): void}} props The result of `soldierIndex`, the input
 *     placeholder, whether to take focus on mount, and what to call with the chosen
 *     soldier.
 * @returns {!preact.VNode} The search bar.
 */
export function SoldierSearch({ index, placeholder, autoFocus, onSelect }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const results = open ? findSoldier(index, query).slice(0, 8) : [];
  const expanded = results.length > 0;

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

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

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
   * Empties the box and puts the cursor back in it, as a search engine's clear button does.
   * @returns {void}
   */
  function clear() {
    setQuery('');
    setHighlight(0);
    setOpen(true);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }

  /**
   * Moves the highlighted row, or commits it on Enter.
   * @param {!KeyboardEvent} event The keydown.
   * @returns {void}
   */
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!expanded) {
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
    }
  }

  return (
    <div class={'soldiersearch' + (expanded ? ' soldiersearch--open' : '')} ref={rootRef}>
      <div class="soldiersearch__bar">
        <span class="soldiersearch__lead">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          class="soldiersearch__input"
          type="search"
          role="combobox"
          aria-label="Search for a soldier by 4D or name"
          aria-expanded={expanded}
          aria-autocomplete="list"
          autoComplete="off"
          spellcheck={false}
          placeholder={placeholder || 'Search by 4D or name'}
          value={query}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query !== '' ? (
          <button type="button" class="soldiersearch__clear" aria-label="Clear search" onClick={clear}>
            <ClearIcon />
          </button>
        ) : null}
      </div>
      {expanded ? (
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
                <span class="soldiersearch__glyph">
                  <SoldierIcon />
                </span>
                <span class="soldiersearch__text">
                  <span class="soldiersearch__name">{soldier.name || '(name not on record)'}</span>
                  <span class="soldiersearch__meta">
                    {[soldier.fourD, soldier.company].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
