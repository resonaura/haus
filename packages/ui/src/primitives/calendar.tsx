/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import { colorToken, corners, insets, px, rgba } from '../ir/geometry.js';
import { SolidMaterial } from '../ir/materials.js';
import { useHausUi } from './context.js';
import { Box, Grid, Pressable, Row, Stack, Text } from './elements.js';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

function parseYmd(value: string): { year: number; month: number; day: number } {
  const [y, m, d] = value.split('-').map((n) => Number.parseInt(n, 10));
  return {
    year: Number.isFinite(y) ? y! : new Date().getFullYear(),
    month: Number.isFinite(m) ? m! : new Date().getMonth() + 1,
    day: Number.isFinite(d) ? d! : 1,
  };
}

function formatYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface HausCalendarProps {
  /** Selected date in `YYYY-MM-DD` format. */
  readonly value: string;
  /** Latest selectable date in `YYYY-MM-DD` format. */
  readonly maxDate?: string;
  /** Dates (`YYYY-MM-DD`) that display a recorded activity indicator dot. */
  readonly markedDates?: ReadonlySet<string>;
  readonly ariaLabel?: string;
  readonly onChange: (day: string) => void;
  readonly onMonthChange?: (yearMonth: string) => void;
}

/**
 * Pure adapter-backed month calendar built strictly from `@haus/ui` primitives — ZERO HTML tags.
 */
export function HausCalendar({
  value,
  maxDate,
  markedDates,
  ariaLabel = 'Calendar',
  onChange,
  onMonthChange,
}: HausCalendarProps): React.ReactElement {
  const { theme } = useHausUi();
  const initial = parseYmd(value);
  const [cursor, setCursor] = React.useState<{ year: number; month: number }>({
    year: initial.year,
    month: initial.month,
  });

  React.useEffect(() => {
    const parsed = parseYmd(value);
    setCursor({ year: parsed.year, month: parsed.month });
  }, [value]);

  const shiftMonth = (delta: number) => {
    const nextDate = new Date(cursor.year, cursor.month - 1 + delta, 1);
    const next = { year: nextDate.getFullYear(), month: nextDate.getMonth() + 1 };
    setCursor(next);
    onMonthChange?.(`${String(next.year).padStart(4, '0')}-${String(next.month).padStart(2, '0')}`);
  };

  const firstWeekday = new Date(cursor.year, cursor.month - 1, 1).getDay();
  const daysInMonth = new Date(cursor.year, cursor.month, 0).getDate();
  const monthLabel = new Date(cursor.year, cursor.month - 1, 1).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  });

  const cells: Array<{ key: string; day: number | null; ymd?: string }> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ key: `pad-${i}`, day: null });
  for (let day = 1; day <= daysInMonth; day++) {
    const ymd = formatYmd(cursor.year, cursor.month, day);
    cells.push({ key: ymd, day, ymd });
  }

  return (
    <Stack gapPx={10} role="group" ariaLabel={ariaLabel} style={{ layout: { minWidth: px(252) } }}>
      <Row justify="between">
        <Pressable
          ariaLabel="Previous month"
          style={{
            layout: {
              width: px(28),
              height: px(28),
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
            corners: corners(8, 'superellipse', 1.4),
            material: new SolidMaterial(rgba(128, 128, 128, 0.12)),
            border: { width: 0, style: 'none', color: rgba(0, 0, 0, 0) },
            typography: { size: 14, color: colorToken('textPrimary') },
            cursor: 'pointer',
          }}
          onActivate={() => shiftMonth(-1)}
        >
          ‹
        </Pressable>
        <Text tone="primary" size={13} weight={600}>
          {monthLabel}
        </Text>
        <Pressable
          ariaLabel="Next month"
          style={{
            layout: {
              width: px(28),
              height: px(28),
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
            corners: corners(8, 'superellipse', 1.4),
            material: new SolidMaterial(rgba(128, 128, 128, 0.12)),
            border: { width: 0, style: 'none', color: rgba(0, 0, 0, 0) },
            typography: { size: 14, color: colorToken('textPrimary') },
            cursor: 'pointer',
          }}
          onActivate={() => shiftMonth(1)}
        >
          ›
        </Pressable>
      </Row>

      <Grid columns={7} gapPx={4}>
        {WEEKDAYS.map((wd) => (
          <Box
            key={wd}
            style={{
              layout: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: px(22),
              },
            }}
          >
            <Text tone="muted" size={11} weight={600}>
              {wd}
            </Text>
          </Box>
        ))}
        {cells.map((cell) => {
          if (cell.day === null || !cell.ymd) return <Box key={cell.key} />;
          const selected = cell.ymd === value;
          const marked = markedDates?.has(cell.ymd) ?? false;
          const disabled = Boolean(maxDate && cell.ymd > maxDate);
          return (
            <Pressable
              key={cell.key}
              disabled={disabled}
              ariaPressed={selected}
              ariaLabel={cell.ymd}
              style={{
                layout: {
                  display: 'flex',
                  direction: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: px(32),
                  gap: px(2),
                  padding: insets(2),
                },
                material: selected
                  ? new SolidMaterial(theme.color('accent'))
                  : new SolidMaterial(rgba(0, 0, 0, 0)),
                corners: corners(10, 'superellipse', 1.4),
                border: { width: 0, style: 'none', color: rgba(0, 0, 0, 0) },
                typography: {
                  size: 12,
                  weight: selected ? 700 : 500,
                  color: selected ? colorToken('accentForeground') : colorToken('textPrimary'),
                },
                opacity: disabled ? 0.35 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
                states: {
                  hover: selected
                    ? undefined
                    : { material: new SolidMaterial(rgba(128, 128, 128, 0.14)) },
                },
              }}
              onActivate={() => onChange(cell.ymd!)}
            >
              <Text
                size={12}
                weight={selected ? 700 : 500}
                style={{
                  typography: {
                    color: selected ? colorToken('accentForeground') : colorToken('textPrimary'),
                  },
                }}
              >
                {cell.day}
              </Text>
              {marked && (
                <Box
                  style={{
                    layout: { width: px(4), height: px(4) },
                    material: new SolidMaterial(
                      selected ? colorToken('accentForeground') : theme.color('accent'),
                    ),
                    corners: corners(999, 'round'),
                  }}
                />
              )}
            </Pressable>
          );
        })}
      </Grid>
    </Stack>
  );
}
