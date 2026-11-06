/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import React, { useState } from 'react';
import type { TimeRangePreset, StatGraphCardProps } from './types.js';
import { TimeRangeSelector } from './TimeRangeSelector.js';
import { TimeseriesChart } from './TimeseriesChart.js';

export const StatGraphCard: React.FC<StatGraphCardProps> = ({
  title,
  metadata,
  data,
  currentVal,
  unit = metadata?.unit ?? '',
  selectedPreset = '24h',
  onPresetChange,
  isLoading = false,
  className = '',
}) => {
  const [internalPreset, setInternalPreset] = useState<TimeRangePreset>(selectedPreset);
  const activePreset = onPresetChange ? selectedPreset : internalPreset;

  const handlePresetSelect = (preset: TimeRangePreset) => {
    setInternalPreset(preset);
    onPresetChange?.(preset);
  };

  // Compute summary stats from data
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let count = 0;

  for (const p of data) {
    const val = p.value ?? p.mean ?? p.last;
    if (val !== undefined && val !== null) {
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
      count++;
    }
  }

  const avg = count > 0 ? sum / count : 0;
  const latestValue =
    currentVal ??
    (data.length > 0
      ? (data[data.length - 1]?.value ?? data[data.length - 1]?.last ?? null)
      : null);

  return React.createElement(
    'div',
    {
      className: `haus-stat-graph-card ${className}`.trim(),
      style: {
        backgroundColor: 'rgba(26, 26, 34, 0.75)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '14px',
        padding: '16px',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
      },
    },
    // Header
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
        },
      },
      React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          { style: { fontSize: '13px', fontWeight: 500, color: 'rgba(255, 255, 255, 0.65)' } },
          title,
        ),
        React.createElement(
          'div',
          {
            style: {
              fontSize: '24px',
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '-0.5px',
              display: 'flex',
              alignItems: 'baseline',
              gap: '4px',
            },
          },
          latestValue !== null ? latestValue.toFixed(1) : '—',
          unit &&
            React.createElement(
              'span',
              { style: { fontSize: '13px', fontWeight: 500, color: 'rgba(255, 255, 255, 0.5)' } },
              unit,
            ),
        ),
      ),
      React.createElement(TimeRangeSelector, {
        selected: activePreset,
        onChange: handlePresetSelect,
      }),
    ),
    // Chart
    React.createElement(
      'div',
      { style: { width: '100%', position: 'relative' } },
      isLoading &&
        React.createElement(
          'div',
          {
            style: {
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(26, 26, 34, 0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 5,
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '12px',
            },
          },
          'Loading...',
        ),
      React.createElement(TimeseriesChart, {
        data,
        unit,
        height: 160,
        isLive: true,
      }),
    ),
    // Footer Stats Summary
    count > 0 &&
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-around',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            paddingTop: '10px',
            fontSize: '11px',
            color: 'rgba(255, 255, 255, 0.55)',
          },
        },
        React.createElement(
          'div',
          null,
          'Min: ',
          React.createElement(
            'span',
            { style: { color: '#ffffff', fontWeight: 600 } },
            `${min.toFixed(1)} ${unit}`.trim(),
          ),
        ),
        React.createElement(
          'div',
          null,
          'Avg: ',
          React.createElement(
            'span',
            { style: { color: '#ffffff', fontWeight: 600 } },
            `${avg.toFixed(1)} ${unit}`.trim(),
          ),
        ),
        React.createElement(
          'div',
          null,
          'Max: ',
          React.createElement(
            'span',
            { style: { color: '#ffffff', fontWeight: 600 } },
            `${max.toFixed(1)} ${unit}`.trim(),
          ),
        ),
      ),
  );
};
