/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import React, { useState } from 'react';
import { StatGraphCard, getTimeRangeBounds, type TimeRangePreset } from '@haus/ui';
import type { StatsDataPoint, StatisticMetadata } from '@haus/core';

export interface TelemetryWidgetProps {
  readonly title: string;
  readonly metadata?: StatisticMetadata;
  readonly initialData?: readonly StatsDataPoint[];
  readonly currentVal?: number | null;
  readonly unit?: string;
  readonly onRangeChange?: (from: number, to: number, preset: TimeRangePreset) => void;
  readonly className?: string;
}

/**
 * Desktop interactive telemetry and timeseries widget.
 * Wraps @haus/ui StatGraphCard with automatic time-range bound calculations and live state updates.
 */
export const TelemetryWidget: React.FC<TelemetryWidgetProps> = ({
  title,
  metadata,
  initialData = [],
  currentVal,
  unit,
  onRangeChange,
  className = '',
}) => {
  const [preset, setPreset] = useState<TimeRangePreset>('24h');

  const handlePresetChange = (newPreset: TimeRangePreset) => {
    setPreset(newPreset);
    if (onRangeChange) {
      const bounds = getTimeRangeBounds(newPreset);
      onRangeChange(bounds.from, bounds.to, newPreset);
    }
  };

  return React.createElement(StatGraphCard, {
    title,
    metadata,
    data: initialData,
    currentVal,
    unit,
    selectedPreset: preset,
    onPresetChange: handlePresetChange,
    className,
  });
};
