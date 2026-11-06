/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { DeviceCategory } from '../categories/index.js';

export function formatTemperature(celsius: number, unit: 'C' | 'F' = 'C', precision = 1): string {
  if (!Number.isFinite(celsius)) return '--';
  const val = unit === 'F' ? (celsius * 9) / 5 + 32 : celsius;
  return `${val.toFixed(precision)}°${unit}`;
}

export function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) return '--%';
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return `${clamped}%`;
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'never';
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));

  if (elapsedSeconds < 10) return 'just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;

  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatBatteryLevel(level?: number | null, isCharging = false): string {
  if (level === undefined || level === null || !Number.isFinite(level)) return 'No battery';
  const pct = formatPercentage(level);
  return isCharging ? `${pct} (Charging)` : pct;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDeviceState(
  category: DeviceCategory,
  state: string,
  attributes: Record<string, unknown> = {},
): string {
  const normState = state.toLowerCase().trim();

  if (normState === 'unavailable') return 'Offline';
  if (normState === 'unknown') return 'Unknown';

  switch (category) {
    case 'lights': {
      if (normState === 'on') {
        const brightness = attributes.brightness;
        if (typeof brightness === 'number') {
          return `On · ${Math.round((brightness / 255) * 100)}%`;
        }
        return 'On';
      }
      return 'Off';
    }
    case 'climate': {
      const temp = attributes.current_temperature ?? attributes.temperature;
      if (typeof temp === 'number') {
        const mode = normState !== 'off' ? normState : 'Off';
        return `${mode} · ${temp.toFixed(1)}°`;
      }
      return normState;
    }
    case 'covers': {
      const pos = attributes.current_position;
      if (typeof pos === 'number') {
        if (pos === 0) return 'Closed';
        if (pos === 100) return 'Open';
        return `Open ${pos}%`;
      }
      return normState === 'open' ? 'Open' : normState === 'closed' ? 'Closed' : normState;
    }
    case 'media': {
      if (['playing', 'paused'].includes(normState)) {
        const title = attributes.media_title;
        return typeof title === 'string' ? `${normState} · ${title}` : normState;
      }
      return normState;
    }
    case 'sensors': {
      const unit = attributes.unit_of_measurement;
      if (unit && typeof unit === 'string') {
        return `${state} ${unit}`;
      }
      return state;
    }
    default:
      return normState === 'on' ? 'On' : normState === 'off' ? 'Off' : state;
  }
}
