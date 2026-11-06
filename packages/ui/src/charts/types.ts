/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { StatsDataPoint, StatisticMetadata } from '@haus/core';

export type TimeRangePreset = '1h' | '24h' | '7d' | '30d' | '1y' | 'custom';

export interface TimeRangeBounds {
  readonly from: number;
  readonly to: number;
  readonly preset: TimeRangePreset;
}

export interface ChartDimensions {
  readonly width: number;
  readonly height: number;
  readonly paddingTop?: number;
  readonly paddingRight?: number;
  readonly paddingBottom?: number;
  readonly paddingLeft?: number;
}

export interface TimeseriesChartProps {
  readonly data: readonly StatsDataPoint[];
  readonly unit?: string;
  readonly height?: number;
  readonly strokeColor?: string;
  readonly fillColor?: string;
  readonly showMinMaxBand?: boolean;
  readonly showGrid?: boolean;
  readonly isLive?: boolean;
  readonly onHoverPoint?: (point: StatsDataPoint | null) => void;
  readonly className?: string;
}

export interface StatGraphCardProps {
  readonly title: string;
  readonly metadata?: StatisticMetadata;
  readonly data: readonly StatsDataPoint[];
  readonly currentVal?: number | null;
  readonly unit?: string;
  readonly selectedPreset?: TimeRangePreset;
  readonly onPresetChange?: (preset: TimeRangePreset) => void;
  readonly isLoading?: boolean;
  readonly className?: string;
}
