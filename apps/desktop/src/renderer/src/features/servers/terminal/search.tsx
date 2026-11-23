/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Box, Pressable, Text, TextInput } from '@haus/ui';
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
    <Box
      className="server-terminal-search"
      dataAttrs={{ open }}
      inert={!open}
      ariaHidden={!open}
      role="search"
      ariaLabel="Search terminal output"
    >
      <Box className="server-terminal-search-main">
        <Search size={15} />
        <TextInput
          inputRef={inputRef}
          ariaLabel="Search terminal output"
          value={query}
          placeholder="Find in terminal"
          onChange={onQueryChange}
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
        <Text>
          {result.resultCount
            ? `${result.resultIndex + 1} / ${result.resultCount}`
            : query
              ? 'No matches'
              : ''}
        </Text>
        <Pressable ariaLabel="Previous match" onPress={() => onFind(true)}>
          <ArrowUp size={15} />
        </Pressable>
        <Pressable ariaLabel="Next match" onPress={() => onFind(false)}>
          <ArrowDown size={15} />
        </Pressable>
        <Pressable ariaLabel="Close search" onPress={onClose}>
          <X size={15} />
        </Pressable>
      </Box>
      <Box className="server-terminal-search-options">
        {(
          [
            ['caseSensitive', 'Aa', 'Match case'],
            ['wholeWord', 'ab', 'Whole word'],
            ['regex', '.*', 'Regular expression'],
          ] as const
        ).map(([key, label, title]) => (
          <Pressable
            key={key}
            title={title}
            ariaLabel={title}
            ariaPressed={options[key]}
            onPress={() => onOptionsChange((value) => ({ ...value, [key]: !value[key] }))}
          >
            {label}
          </Pressable>
        ))}
        <Text>↵ Next · ⇧↵ Previous · esc Close</Text>
      </Box>
    </Box>
  );
}
