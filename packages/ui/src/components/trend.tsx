/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useId } from 'react';
import { colorToken } from '../ir/geometry.js';
import { useHausUi } from '../primitives/context.js';
import { Box, Text } from '../primitives/elements.js';
import { VectorGraphic } from '../primitives/media.js';
import { resolveColorToCss } from '../renderers/contract.js';

export type TrendPoint = { time: number; value: number };

export function RecorderTrend({
  points,
  label,
  compactDates,
  portable = false,
}: {
  points: readonly TrendPoint[];
  label: string;
  compactDates: boolean;
  portable?: boolean;
}) {
  const { theme } = useHausUi();
  const id = useId().replaceAll(/[^a-zA-Z0-9_-]/g, '');
  const rows = points.filter(
    ({ time, value }) => Math.abs(value) <= Number.MAX_SAFE_INTEGER && Math.abs(time) <= 8.64e15,
  );
  if (!rows.length) return null;
  const values = rows.map(({ value }) => value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = high - low || Math.max(Math.abs(high) * 0.08, 1);
  const left = 28;
  const right = 692;
  const bottom = 154;
  const plotted = rows.map(({ time, value }, index) => ({
    time,
    x: rows.length === 1 ? (left + right) / 2 : left + (index / (rows.length - 1)) * (right - left),
    y: bottom - ((value - low) / spread) * (bottom - 18),
  }));
  const line = plotted.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const accent = resolveColorToCss(colorToken('accent'), theme, false);
  const border = resolveColorToCss(colorToken('border'), theme, false);
  const guides = [18, 63, 108, 154].map(
    (y) => `<path class="recorder-grid-line" d="M ${left} ${y} H ${right}" stroke="${border}"/>`,
  );
  const dots =
    plotted.length < 80
      ? plotted.map(
          ({ x, y }) =>
            `<circle class="recorder-chart-point" cx="${x}" cy="${y}" r="2.5" fill="${accent}"/>`,
        )
      : [];
  const graphic = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 190">
    <defs><linearGradient id="${id}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0" stop-color="${accent}" stop-opacity=".2"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient></defs>
    ${guides.join('')}
    <path d="${line} L ${right} ${bottom} L ${left} ${bottom} Z" fill="url(#${id})"/>
    <path class="recorder-chart-line" d="${line}" fill="none" stroke="${accent}" stroke-width="2"/>
    ${dots.join('')}
  </svg>`;
  const dates = new Intl.DateTimeFormat(
    undefined,
    compactDates ? { hour: 'numeric' } : { month: 'short', day: 'numeric' },
  );
  const indices = [...new Set([0, Math.floor((plotted.length - 1) / 2), plotted.length - 1])];
  return (
    <Box className="recorder-chart">
      <VectorGraphic
        id="recorder-trend"
        viewWidth={720}
        viewHeight={190}
        width="100%"
        height={190}
        role="img"
        ariaLabel={label}
        rawSvgMarkup={graphic}
      />
      <Box
        className="recorder-chart-labels"
        style={portable ? { layout: { direction: 'row', justifyContent: 'between' } } : undefined}
      >
        {indices.map((index) => (
          <Text key={index} tone={portable ? 'muted' : undefined} size={portable ? 11 : undefined}>
            {dates.format(plotted[index].time)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
