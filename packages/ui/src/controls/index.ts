/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface ToggleControlState {
  readonly on: boolean;
  readonly pending: boolean;
  readonly disabled?: boolean;
}

export function computeToggleOptimisticState(
  currentState: ToggleControlState,
  desiredOn?: boolean,
): ToggleControlState {
  return {
    on: desiredOn ?? !currentState.on,
    pending: true,
    disabled: currentState.disabled,
  };
}

export interface SliderControlState {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly unit?: string;
  readonly pending?: boolean;
  readonly disabled?: boolean;
}

export function clampSliderValue(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface HsvColor {
  readonly h: number; // 0 - 360
  readonly s: number; // 0 - 100
  readonly v: number; // 0 - 100
}

export function kelvinToRgb(kelvin: number): RgbColor {
  const temp = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r: number, g: number, b: number;

  if (temp <= 66) {
    r = 255;
    g = Math.max(0, Math.min(255, 99.4708025861 * Math.log(temp) - 161.1195681661));
    b =
      temp <= 19
        ? 0
        : Math.max(0, Math.min(255, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
  } else {
    r = Math.max(0, Math.min(255, 329.698727446 * Math.pow(temp - 60, -0.1332047592)));
    g = Math.max(0, Math.min(255, 288.1221695283 * Math.pow(temp - 60, -0.0755148492)));
    b = 255;
  }

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

export function miredsToKelvin(mireds: number): number {
  if (mireds <= 0) return 2700;
  return Math.round(1000000 / mireds);
}

export function kelvinToMireds(kelvin: number): number {
  if (kelvin <= 0) return 370;
  return Math.round(1000000 / kelvin);
}

export function hsvToRgb(hsv: HsvColor): RgbColor {
  const h = hsv.h / 360;
  const s = hsv.s / 100;
  const v = hsv.v / 100;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0,
    g = 0,
    b = 0;

  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

export function rgbToHsv(rgb: RgbColor): HsvColor {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : Math.round((delta / max) * 100);
  const v = Math.round(max * 100);

  return { h, s, v };
}

export type HvacMode = 'off' | 'heat' | 'cool' | 'auto' | 'dry' | 'fan_only';

export const SUPPORTED_HVAC_MODES: readonly HvacMode[] = [
  'off',
  'heat',
  'cool',
  'auto',
  'dry',
  'fan_only',
];

export interface ClimateControlState {
  readonly currentTemperature: number;
  readonly targetTemperature: number;
  readonly targetTemperatureHigh?: number;
  readonly targetTemperatureLow?: number;
  readonly hvacMode: HvacMode;
  readonly minTemp: number;
  readonly maxTemp: number;
  readonly step: number;
  readonly unit: 'C' | 'F';
  readonly pending?: boolean;
}

export function clampTargetTemperature(temp: number, minTemp = 10, maxTemp = 35): number {
  return Math.max(minTemp, Math.min(maxTemp, temp));
}

export type MediaPlaybackStatus = 'playing' | 'paused' | 'idle' | 'buffering' | 'off';

export interface MediaControlState {
  readonly status: MediaPlaybackStatus;
  readonly volume: number; // 0 - 100
  readonly isMuted: boolean;
  readonly mediaTitle?: string;
  readonly mediaArtist?: string;
  readonly durationSeconds?: number;
  readonly positionSeconds?: number;
}
