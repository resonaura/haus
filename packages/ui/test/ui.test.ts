/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { darkThemeTokens, lightThemeTokens, getThemeTokens } from '../src/tokens/index.js';
import {
  ALL_DEVICE_CATEGORIES,
  getCategoryMetadata,
  isDeviceCategory,
} from '../src/categories/index.js';
import {
  computeToggleOptimisticState,
  clampSliderValue,
  kelvinToRgb,
  miredsToKelvin,
  kelvinToMireds,
  rgbToHsv,
  hsvToRgb,
  clampTargetTemperature,
  SUPPORTED_HVAC_MODES,
} from '../src/controls/index.js';
import {
  formatTemperature,
  formatPercentage,
  formatRelativeTime,
  formatBatteryLevel,
  formatDuration,
  formatDeviceState,
} from '../src/formatters/index.js';
import { StatusBadge, CategoryIcon, DeviceCard, ControlTile } from '../src/components/index.js';

describe('@haus/ui Design Tokens', () => {
  it('provides complete dark and light tokens with consistent keys', () => {
    expect(darkThemeTokens.mode).toBe('dark');
    expect(lightThemeTokens.mode).toBe('light');
    expect(darkThemeTokens.colors.background).toBe('#0d0f12');
    expect(lightThemeTokens.colors.background).toBe('#f9fafb');
    expect(darkThemeTokens.typography.fontSize.body).toBe('14px');
    expect(darkThemeTokens.spacing[16]).toBe('16px');
    expect(darkThemeTokens.radii.lg).toBe('16px');
    expect(getThemeTokens('dark')).toEqual(darkThemeTokens);
    expect(getThemeTokens('light')).toEqual(lightThemeTokens);
  });
});

describe('@haus/ui Device Categories', () => {
  it('covers all 13 canonical device categories with rich metadata', () => {
    expect(ALL_DEVICE_CATEGORIES.length).toBe(13);
    expect(ALL_DEVICE_CATEGORIES).toContain('lights');
    expect(ALL_DEVICE_CATEGORIES).toContain('climate');
    expect(ALL_DEVICE_CATEGORIES).toContain('security');
    expect(ALL_DEVICE_CATEGORIES).toContain('appliances');
    expect(ALL_DEVICE_CATEGORIES).toContain('robotics');

    for (const category of ALL_DEVICE_CATEGORIES) {
      const meta = getCategoryMetadata(category);
      expect(meta.id).toBe(category);
      expect(typeof meta.label).toBe('string');
      expect(typeof meta.iconName).toBe('string');
      expect(typeof meta.accentColor).toBe('string');
      expect(meta.supportedControls.length).toBeGreaterThan(0);
      expect(isDeviceCategory(category)).toBe(true);
    }

    expect(isDeviceCategory('non_existent')).toBe(false);
  });
});

describe('@haus/ui Interactive Controls & Math', () => {
  it('computes optimistic toggle transitions without state corruption', () => {
    const initial = { on: false, pending: false };
    const toggled = computeToggleOptimisticState(initial);
    expect(toggled.on).toBe(true);
    expect(toggled.pending).toBe(true);

    const explicitOff = computeToggleOptimisticState({ on: true, pending: false }, false);
    expect(explicitOff.on).toBe(false);
    expect(explicitOff.pending).toBe(true);
  });

  it('clamps slider and target temperature bounds safely', () => {
    expect(clampSliderValue(150, 0, 100)).toBe(100);
    expect(clampSliderValue(-20, 0, 100)).toBe(0);
    expect(clampSliderValue(50, 0, 100)).toBe(50);
    expect(clampSliderValue(NaN, 0, 100)).toBe(0);

    expect(clampTargetTemperature(40, 10, 35)).toBe(35);
    expect(clampTargetTemperature(5, 10, 35)).toBe(10);
    expect(clampTargetTemperature(21.5, 10, 35)).toBe(21.5);
  });

  it('accurately converts color temperatures and coordinates', () => {
    // 2700K warm white
    const warm = kelvinToRgb(2700);
    expect(warm.r).toBe(255);
    expect(warm.b).toBeLessThan(warm.r);

    // 6500K daylight cool
    const cool = kelvinToRgb(6500);
    expect(cool.b).toBeGreaterThan(200);

    // Mireds roundtrip
    expect(miredsToKelvin(370)).toBe(2703);
    expect(kelvinToMireds(2700)).toBe(370);

    // HSV / RGB
    const pureRedRgb = { r: 255, g: 0, b: 0 };
    const hsv = rgbToHsv(pureRedRgb);
    expect(hsv.h).toBe(0);
    expect(hsv.s).toBe(100);
    expect(hsv.v).toBe(100);
    expect(hsvToRgb(hsv)).toEqual(pureRedRgb);
  });

  it('defines standard HVAC modes', () => {
    expect(SUPPORTED_HVAC_MODES).toContain('heat');
    expect(SUPPORTED_HVAC_MODES).toContain('cool');
    expect(SUPPORTED_HVAC_MODES).toContain('auto');
    expect(SUPPORTED_HVAC_MODES).toContain('off');
  });
});

describe('@haus/ui Formatters', () => {
  it('formats temperatures in Celsius and Fahrenheit', () => {
    expect(formatTemperature(21.4, 'C')).toBe('21.4°C');
    expect(formatTemperature(21.4, 'F')).toBe('70.5°F');
    expect(formatTemperature(NaN)).toBe('--');
  });

  it('formats percentages and durations', () => {
    expect(formatPercentage(84.3)).toBe('84%');
    expect(formatPercentage(150)).toBe('100%');
    expect(formatPercentage(-10)).toBe('0%');
    expect(formatPercentage(NaN)).toBe('--%');

    expect(formatDuration(125)).toBe('2:05');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(undefined)).toBe('0:00');
  });

  it('formats relative elapsed time', () => {
    const now = 1000000000;
    expect(formatRelativeTime(now - 4000, now)).toBe('just now');
    expect(formatRelativeTime(now - 35000, now)).toBe('35s ago');
    expect(formatRelativeTime(now - 120000, now)).toBe('2m ago');
    expect(formatRelativeTime(now - 7200000, now)).toBe('2h ago');
    expect(formatRelativeTime(now - 172800000, now)).toBe('2d ago');
    expect(formatRelativeTime(0, now)).toBe('never');
  });

  it('formats battery levels with charging indicators', () => {
    expect(formatBatteryLevel(85, false)).toBe('85%');
    expect(formatBatteryLevel(85, true)).toBe('85% (Charging)');
    expect(formatBatteryLevel(null)).toBe('No battery');
  });

  it('formats device state summaries across categories', () => {
    expect(formatDeviceState('lights', 'on', { brightness: 128 })).toBe('On · 50%');
    expect(formatDeviceState('lights', 'off')).toBe('Off');
    expect(formatDeviceState('climate', 'heat', { current_temperature: 22.0 })).toBe(
      'heat · 22.0°',
    );
    expect(formatDeviceState('covers', 'open', { current_position: 80 })).toBe('Open 80%');
    expect(formatDeviceState('media', 'playing', { media_title: 'Subway Surfers' })).toBe(
      'playing · Subway Surfers',
    );
    expect(formatDeviceState('sensors', '24.5', { unit_of_measurement: 'kWh' })).toBe('24.5 kWh');
    expect(formatDeviceState('lights', 'unavailable')).toBe('Offline');
  });
});

describe('@haus/ui Presentation Components', () => {
  it('instantiates StatusBadge and CategoryIcon elements', () => {
    const badge = React.createElement(StatusBadge, { status: 'online' });
    expect(React.isValidElement(badge)).toBe(true);
    expect(badge.props.status).toBe('online');

    const icon = React.createElement(CategoryIcon, { category: 'climate', size: 28 });
    expect(React.isValidElement(icon)).toBe(true);
    expect(icon.props.category).toBe('climate');
    expect(icon.props.size).toBe(28);
  });

  it('instantiates DeviceCard and ControlTile elements', () => {
    const card = React.createElement(DeviceCard, {
      title: 'Living Room Ceiling',
      subtitle: 'Living Room',
      category: 'lights',
      status: 'online',
    });
    expect(React.isValidElement(card)).toBe(true);
    expect(card.props.title).toBe('Living Room Ceiling');
    expect(card.props.category).toBe('lights');

    const tile = React.createElement(ControlTile, {
      title: 'Floor Lamp',
      stateText: 'On · 80%',
      category: 'lights',
      active: true,
    });
    expect(React.isValidElement(tile)).toBe(true);
    expect(tile.props.active).toBe(true);
  });
});
