/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import React from 'react';
import type { TimeRangePreset } from './types.js';
import { PRESET_LABELS } from './time-range.js';

export interface TimeRangeSelectorProps {
  readonly selected: TimeRangePreset;
  readonly onChange: (preset: TimeRangePreset) => void;
  readonly presets?: readonly TimeRangePreset[];
  readonly className?: string;
}

const DEFAULT_PRESETS: readonly TimeRangePreset[] = ['1h', '24h', '7d', '30d', '1y'];

export const TimeRangeSelector: React.FC<TimeRangeSelectorProps> = ({
  selected,
  onChange,
  presets = DEFAULT_PRESETS,
  className = '',
}) => {
  return React.createElement(
    'div',
    {
      className: `haus-time-range-selector ${className}`.trim(),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        borderRadius: '8px',
        padding: '2px',
      },
    },
    presets.map((preset) => {
      const isSelected = selected === preset;
      return React.createElement(
        'button',
        {
          key: preset,
          type: 'button',
          onClick: () => onChange(preset),
          className: `haus-time-range-btn ${isSelected ? 'active' : ''}`.trim(),
          style: {
            border: 'none',
            outline: 'none',
            cursor: 'pointer',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: isSelected ? 600 : 500,
            color: isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.65)',
            backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.16)' : 'transparent',
            transition: 'all 0.15s ease',
          },
        },
        PRESET_LABELS[preset],
      );
    }),
  );
};
