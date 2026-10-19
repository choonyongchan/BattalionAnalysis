/**
 * The 4D-or-name search bar, shaped like a search engine's box (magnifier, clear button, suggestions
 * growing from its lower edge). Only the chosen soldier is reported; typing state stays local.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useOutsideClick } from './useOutsideClick.ts';
import { ClearIcon, SearchIcon, SoldierIcon } from '../app/icons.tsx';
import { findSoldier, type SoldierEntry } from '../model/soldier.ts';

/** A search bar over `soldierIndex` with live suggestions; `onSelect` gets the chosen soldier. */
export function SoldierSearch({
  index,
  placeholder = 'Search by 4D or name',
  autoFocus = false,
  onSelect,
}: {
  index: SoldierEntry[];
  placeholder?: string;
  autoFocus?: boolean;
  onSelect: (soldier: SoldierEntry) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = open ? findSoldier(index, query).slice(0, 8) : [];
  const expanded = results.length > 0;

  useOutsideClick(rootRef, open, () => setOpen(false));

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  /** Commits a suggestion: closes the list and reports the soldier. */
  function choose(soldier: SoldierEntry) {
    setQuery(soldier.name || soldier.fourD);
    setOpen(false);
    onSelect(soldier);
  }

  /** Empties the box and puts the cursor back in it. */
  function clear() {
    setQuery('');
    setHighlight(0);
    setOpen(true);
    inputRef.current?.focus();
  }

  /** Arrow keys move the highlight, Enter commits it, Escape closes the list. */
  function onKeyDown(event: KeyboardEvent) {
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
      const soldier = results[highlight];
      if (soldier) choose(soldier);
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
          placeholder={placeholder}
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
