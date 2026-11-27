/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type * as React from 'react';
import type { TerminalSearchOptions } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, Pressable, Row, Stack, Text, TextInput } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

export type { TerminalSearchOptions };

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
  readonly onOptionsChange: (next: TerminalSearchOptions) => void;
  readonly result: { readonly resultIndex: number; readonly resultCount: number };
  readonly error?: string;
  readonly inputRef?: React.Ref<unknown> | { readonly current: unknown };
  readonly className?: string;
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
  error,
  inputRef,
  className = 'server-terminal-search',
  onFind,
  onClose,
}: TerminalSearchBarProps) {
  const countLabel = error
    ? error
    : result.resultCount > 0
      ? `${result.resultIndex + 1} / ${result.resultCount}`
      : query
        ? 'No matches'
        : '';

  return (
    <Stack
      id="terminal-search-bar"
      gapPx={8}
      className={className}
      dataAttrs={{ open }}
      inert={!open}
      ariaHidden={!open}
      role="search"
      ariaLabel="Search terminal output"
      style={{
        layout: { width: pct(100), padding: insets(8, 10) },
        material: new SolidMaterial(colorToken('surface')),
        border: { width: 1, color: colorToken('border') },
        corners: corners(10),
      }}
    >
      <Row
        align="center"
        gapPx={8}
        className="server-terminal-search-main"
        style={{ layout: { width: pct(100) } }}
      >
        <UiIcon name="search" size={14} />
        <Box style={{ layout: { flexGrow: 1, minWidth: px(120) } }}>
          <TextInput
            id="terminal-search-input"
            inputRef={inputRef as React.Ref<unknown>}
            ariaLabel="Search terminal output"
            value={query}
            placeholder="Find in terminal"
            onChange={onQueryChange}
            onSubmit={() => onFind(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onFind(event.shiftKey);
              }
              if (event.key === 'Escape') {
                onClose();
              }
            }}
            style={{
              layout: { width: pct(100), height: px(28), padding: insets(0, 8) },
              material: new SolidMaterial(colorToken('surfaceSecondary')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(7),
              typography: { size: 12, color: colorToken('textPrimary') },
            }}
          />
        </Box>
        {countLabel && (
          <Text id="terminal-search-count" size={11} tone={error ? 'critical' : 'muted'}>
            {countLabel}
          </Text>
        )}
        <Pressable
          id="terminal-search-prev"
          ariaLabel="Previous match"
          onActivate={() => onFind(true)}
          style={{
            layout: {
              direction: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              padding: insets(4, 6),
            },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            corners: corners(6),
          }}
        >
          <UiIcon name="arrow-up" size={14} />
        </Pressable>
        <Pressable
          id="terminal-search-next"
          ariaLabel="Next match"
          onActivate={() => onFind(false)}
          style={{
            layout: {
              direction: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              padding: insets(4, 6),
            },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            corners: corners(6),
          }}
        >
          <UiIcon name="arrow-down" size={14} />
        </Pressable>
        <Pressable
          id="terminal-search-close"
          ariaLabel="Close search"
          onActivate={onClose}
          style={{
            layout: {
              direction: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              padding: insets(4, 6),
            },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            corners: corners(6),
          }}
        >
          <UiIcon name="x" size={14} />
        </Pressable>
      </Row>

      <Row align="center" gapPx={6} wrap className="server-terminal-search-options">
        {(
          [
            ['caseSensitive', 'Aa', 'Match case'],
            ['wholeWord', 'ab', 'Whole word'],
            ['regex', '.*', 'Regular expression'],
          ] as const
        ).map(([key, label, title]) => {
          const active = options[key];
          return (
            <Pressable
              key={key}
              id={`terminal-search-opt-${key}`}
              title={title}
              ariaLabel={title}
              ariaPressed={active}
              onActivate={() => onOptionsChange({ ...options, [key]: !active })}
              style={{
                layout: { padding: insets(3, 8) },
                material: new SolidMaterial(
                  active ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                ),
                border: {
                  width: 1,
                  color: active ? colorToken('accent') : colorToken('border'),
                },
                corners: corners(6),
              }}
            >
              <Text size={11} weight={active ? 600 : 500} mono>
                {label}
              </Text>
            </Pressable>
          );
        })}
        <Text size={11} tone="muted">
          ↵ Next · ⇧↵ Previous · esc Close
        </Text>
      </Row>
    </Stack>
  );
}
