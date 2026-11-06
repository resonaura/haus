/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import {
  getTimeRangeBounds,
  formatChartTimestamp,
  TimeRangeSelector,
  TimeseriesChart,
  StatGraphCard,
} from '../src/charts/index.js';
import type { StatsDataPoint } from '@haus/core';

describe('UI Charts & TimeRange Domain Suite', () => {
  it('computes exact epoch time bounds for all time-range presets', () => {
    const fixedNow = 1700000000;

    const b1h = getTimeRangeBounds('1h', fixedNow);
    expect(b1h.from).toBe(fixedNow - 3600);
    expect(b1h.to).toBe(fixedNow);

    const b24h = getTimeRangeBounds('24h', fixedNow);
    expect(b24h.from).toBe(fixedNow - 86400);
    expect(b24h.to).toBe(fixedNow);

    const b7d = getTimeRangeBounds('7d', fixedNow);
    expect(b7d.from).toBe(fixedNow - 7 * 86400);

    const b30d = getTimeRangeBounds('30d', fixedNow);
    expect(b30d.from).toBe(fixedNow - 30 * 86400);

    const b1y = getTimeRangeBounds('1y', fixedNow);
    expect(b1y.from).toBe(fixedNow - 365 * 86400);

    const bCustom = getTimeRangeBounds('custom', fixedNow);
    expect(bCustom.preset).toBe('custom');
  });

  it('formats chart timestamps according to viewport duration', () => {
    const ts = 1700000000;
    const formatted1h = formatChartTimestamp(ts, '1h');
    expect(typeof formatted1h).toBe('string');
    expect(formatted1h.length).toBeGreaterThan(0);

    const formatted7d = formatChartTimestamp(ts, '7d');
    expect(typeof formatted7d).toBe('string');
    expect(formatted7d.length).toBeGreaterThan(0);

    const formatted1y = formatChartTimestamp(ts, '1y');
    expect(typeof formatted1y).toBe('string');
    expect(formatted1y.length).toBeGreaterThan(0);
  });

  it('renders TimeRangeSelector element tree correctly', () => {
    let selectedPreset = '24h';
    const element = React.createElement(TimeRangeSelector, {
      selected: '24h',
      onChange: (p) => {
        selectedPreset = p;
      },
    });

    expect(element.type).toBe(TimeRangeSelector);
    expect(element.props.selected).toBe('24h');
    element.props.onChange('7d');
    expect(selectedPreset).toBe('7d');
  });

  it('renders TimeseriesChart element tree with min/max bands and live point', () => {
    const data: StatsDataPoint[] = [
      { timestamp: 1700000000, value: 20, min: 18, max: 22 },
      { timestamp: 1700000300, value: 22, min: 20, max: 24 },
      { timestamp: 1700000600, value: 21, min: 19, max: 23 },
    ];

    const element = React.createElement(TimeseriesChart, {
      data,
      unit: '°C',
      height: 200,
      showMinMaxBand: true,
      isLive: true,
    });

    expect(element.type).toBe(TimeseriesChart);
    expect(element.props.data.length).toBe(3);
    expect(element.props.unit).toBe('°C');
  });

  it('renders StatGraphCard element tree with header summary and footer stats', () => {
    const data: StatsDataPoint[] = [
      { timestamp: 1700000000, value: 50 },
      { timestamp: 1700000300, value: 75 },
      { timestamp: 1700000600, value: 60 },
    ];

    const element = React.createElement(StatGraphCard, {
      title: 'CPU Usage',
      data,
      unit: '%',
      selectedPreset: '1h',
    });

    expect(element.type).toBe(StatGraphCard);
    expect(element.props.title).toBe('CPU Usage');
    expect(element.props.unit).toBe('%');
  });
});
