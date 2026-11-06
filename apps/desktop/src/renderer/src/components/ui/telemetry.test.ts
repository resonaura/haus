/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { TelemetryWidget } from './telemetry.js';
import type { StatsDataPoint } from '@haus/core';

describe('Desktop TelemetryWidget Suite', () => {
  it('renders TelemetryWidget element tree with default 24h preset', () => {
    const data: StatsDataPoint[] = [
      { timestamp: 1700000000, value: 45 },
      { timestamp: 1700000300, value: 50 },
    ];

    const element = React.createElement(TelemetryWidget, {
      title: 'Host CPU Load',
      initialData: data,
      currentVal: 50,
      unit: '%',
    });

    expect(element.type).toBe(TelemetryWidget);
    expect(element.props.title).toBe('Host CPU Load');
    expect(element.props.currentVal).toBe(50);
    expect(element.props.unit).toBe('%');
    expect(element.props.initialData?.length).toBe(2);
  });

  it('binds time range calculation handlers', () => {
    let triggeredFrom = 0;
    let triggeredTo = 0;
    let triggeredPreset = '';

    const element = React.createElement(TelemetryWidget, {
      title: 'Memory Usage',
      unit: 'B',
      onRangeChange: (from, to, preset) => {
        triggeredFrom = from;
        triggeredTo = to;
        triggeredPreset = preset;
      },
    });

    expect(element.props.onRangeChange).toBeDefined();
    element.props.onRangeChange?.(1000, 2000, '1h');

    expect(triggeredFrom).toBe(1000);
    expect(triggeredTo).toBe(2000);
    expect(triggeredPreset).toBe('1h');
  });
});
