/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';

export interface TerminalSearchOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

export const TERMINAL_SEARCH_DECORATIONS = {
  matchBackground: '#ff923055',
  matchBorder: '#ff9230',
  matchOverviewRuler: '#ff9230',
  activeMatchBackground: '#ff9230',
  activeMatchBorder: '#ff9230',
  activeMatchColorOverviewRuler: '#ff9230',
} as const;

export interface TerminalSearchBarProps {
  readonly open: boolean;
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly options: TerminalSearchOptions;
  readonly onOptionsChange: Dispatch<SetStateAction<TerminalSearchOptions>>;
  readonly result: { readonly resultIndex: number; readonly resultCount: number };
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onFind: (backward?: boolean) => void;
  readonly onClose: () => void;
}

export function TerminalSearchBar({
  open,
  query,
  onQueryChange,
  options,
  onOptionsChange,
  result,
  inputRef,
  onFind,
  onClose,
}: TerminalSearchBarProps) {
  return (
    <div
      className="server-terminal-search"
      data-open={open}
      inert={!open}
      aria-hidden={!open}
      role="search"
      aria-label="Search terminal output"
    >
      <div className="server-terminal-search-main">
        <Search size={15} />
        <input
          ref={inputRef}
          aria-label="Search terminal output"
          value={query}
          placeholder="Find in terminal"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onFind(event.shiftKey);
            }
            if (event.key === 'Escape') {
              onClose();
            }
          }}
        />
        <span>
          {result.resultCount
            ? `${result.resultIndex + 1} / ${result.resultCount}`
            : query
              ? 'No matches'
              : ''}
        </span>
        <button type="button" aria-label="Previous match" onClick={() => onFind(true)}>
          <ArrowUp size={15} />
        </button>
        <button type="button" aria-label="Next match" onClick={() => onFind(false)}>
          <ArrowDown size={15} />
        </button>
        <button type="button" aria-label="Close search" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="server-terminal-search-options">
        {(
          [
            ['caseSensitive', 'Aa', 'Match case'],
            ['wholeWord', 'ab', 'Whole word'],
            ['regex', '.*', 'Regular expression'],
          ] as const
        ).map(([key, label, title]) => (
          <button
            type="button"
            key={key}
            title={title}
            aria-label={title}
            aria-pressed={options[key]}
            onClick={() => onOptionsChange((value) => ({ ...value, [key]: !value[key] }))}
          >
            {label}
          </button>
        ))}
        <span>↵ Next · ⇧↵ Previous · esc Close</span>
      </div>
    </div>
  );
}
