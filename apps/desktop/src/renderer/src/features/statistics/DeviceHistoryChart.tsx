/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useId, useMemo, useState } from 'react';
import { Box, Text, VectorGraphic, type HostVectorCircle, type HostVectorLine } from '@haus/ui';
import {
  historyChart,
  nearestHistoryPoint,
  numericState,
  type HistoryPoint,
} from '../../model/device-history';
export function DeviceHistoryChart({
  points,
  from,
  to,
  unit,
  precision = 3,
}: {
  points: HistoryPoint[];
  from: number;
  to: number;
  unit: string;
  precision?: number;
}) {
  const chart = useMemo(() => historyChart(points, from, to), [points, from, to]);
  const [selected, setSelected] = useState<number>();
  const [keyboard, setKeyboard] = useState(false);
  const hint = useId();
  const point = selected === undefined ? undefined : points[Math.min(points.length - 1, selected)];
  const value = point ? numericState(point.state) : undefined;
  const x = point ? 10 + ((Math.max(from, point.at) - from) / Math.max(1, to - from)) * 580 : 0;
  const number = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: precision });
  const time = (at: number) =>
    new Date(at).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  if (!chart.count) return null;

  const lines: HostVectorLine[] = [
    ...[15, 80, 145].map((y) => ({
      x1: 10,
      x2: 590,
      y1: y,
      y2: y,
      className: 'history-grid-line',
    })),
    ...(point ? [{ x1: x, x2: x, y1: 8, y2: 152, className: 'history-cursor' }] : []),
  ];
  const circles: HostVectorCircle[] = [
    ...(chart.samples.length === 1
      ? [
          {
            cx: 10 + ((chart.samples[0].at - from) / Math.max(1, to - from)) * 580,
            cy: 80,
            r: 3,
            fill: 'currentColor',
          },
        ]
      : []),
    ...(point && value !== undefined
      ? [
          {
            cx: x,
            cy:
              chart.high === chart.low
                ? 80
                : 145 - ((value - chart.low) / (chart.high - chart.low)) * 130,
            r: 3.5,
            fill: 'currentColor',
          },
        ]
      : []),
  ];

  return (
    <Box
      className="device-history-chart"
      tabIndex={0}
      role="group"
      ariaLabel="Explore measurement history"
      ariaDescribedBy={hint}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
        event.preventDefault();
        setKeyboard(true);
        if (event.key === 'Escape') setSelected(undefined);
        else
          setSelected(
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? points.length - 1
                : Math.max(
                    0,
                    Math.min(
                      points.length - 1,
                      (selected ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1),
                    ),
                  ),
          );
      }}
      onPointerLeave={() => {
        if (!keyboard) setSelected(undefined);
      }}
    >
      <Box className="history-chart-summary">
        <Text>
          Lowest
          <Text semantic="strong">
            {number(chart.low)} <Text semantic="small">{unit}</Text>
          </Text>
        </Text>
        <Text>
          Highest
          <Text semantic="strong">
            {number(chart.high)} <Text semantic="small">{unit}</Text>
          </Text>
        </Text>
      </Box>
      <Text id={hint} className="sr-only">
        Use the left and right arrow keys to explore readings. Home and End jump to the first and
        last reading.
      </Text>
      <VectorGraphic
        viewWidth={600}
        viewHeight={160}
        role="img"
        ariaLabel={`Recorded range ${number(chart.low)} to ${number(chart.high)} ${unit}. Breaks in the line indicate unavailable or unknown readings.`}
        lines={lines}
        paths={[
          {
            d: chart.path,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            vectorEffect: 'non-scaling-stroke',
          },
        ]}
        circles={circles}
        onPointerMoveRatio={(ratioX) => {
          const fraction = Math.max(0, Math.min(1, (ratioX * 600 - 10) / 580));
          setKeyboard(false);
          setSelected(nearestHistoryPoint(points, from + fraction * (to - from)));
        }}
      />
      <Box className="history-chart-axis">
        <Text semantic="time" dateTime={new Date(from).toISOString()}>
          {time(from)}
        </Text>
        <Text semantic="time" dateTime={new Date(to).toISOString()}>
          {time(to)}
        </Text>
      </Box>
      <Text
        semantic="output"
        className="history-chart-reading"
        ariaLive={keyboard ? 'polite' : 'off'}
      >
        {point ? (
          <>
            <Text semantic="time" dateTime={new Date(point.at).toISOString()}>
              {time(point.at)}
            </Text>
            <Text semantic="strong">
              {value === undefined ? point.state.replaceAll('_', ' ') : `${number(value)} ${unit}`}
            </Text>
          </>
        ) : (
          <Text>Move over the chart or use the arrow keys to explore.</Text>
        )}
      </Text>
    </Box>
  );
}
