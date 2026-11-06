/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { TimeRangeBounds, TimeRangePreset } from './types.js';

export const PRESET_LABELS: Record<TimeRangePreset, string> = {
  '1h': '1h',
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
  '1y': '1y',
  custom: 'Custom',
};

export const PRESET_DURATIONS_SECONDS: Record<Exclude<TimeRangePreset, 'custom'>, number> = {
  '1h': 3600,
  '24h': 86400,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  '1y': 365 * 86400,
};

export function getTimeRangeBounds(preset: TimeRangePreset, nowSeconds?: number): TimeRangeBounds {
  const to = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (preset === 'custom') {
    return {
      from: to - 86400,
      to,
      preset: 'custom',
    };
  }

  const duration = PRESET_DURATIONS_SECONDS[preset];
  return {
    from: to - duration,
    to,
    preset,
  };
}

export function formatChartTimestamp(timestampSeconds: number, preset: TimeRangePreset): string {
  const d = new Date(timestampSeconds * 1000);
  if (preset === '1h' || preset === '24h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (preset === '7d' || preset === '30d') {
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}
