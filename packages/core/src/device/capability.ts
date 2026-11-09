/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Capability } from '../types.js';
import { CapabilityKind } from './enums.js';

export const STANDARD_CAPABILITY_KINDS = Object.values(CapabilityKind) as readonly CapabilityKind[];

export type StandardCapabilityKind = CapabilityKind;

/** Standard On/Off switch capability. */
export const onOffCapability: Capability = {
  id: CapabilityKind.OnOff,
  kind: CapabilityKind.OnOff,
  readable: true,
  operations: ['turn_on', 'turn_off', 'toggle'],
};

/** Standard brightness capability (0-100%). */
export const brightnessCapability: Capability = {
  id: CapabilityKind.Brightness,
  kind: CapabilityKind.Brightness,
  readable: true,
  operations: ['set_brightness'],
  unit: '%',
  minimum: 0,
  maximum: 100,
  step: 1,
};

/** Color temperature capability (in absolute Kelvin, e.g. 2000K-6500K). */
export function createColorTempCapability(minKelvin = 2000, maxKelvin = 6500): Capability {
  return {
    id: CapabilityKind.ColorTemp,
    kind: CapabilityKind.ColorTemp,
    readable: true,
    operations: ['set_color_temp'],
    unit: 'K',
    minimum: minKelvin,
    maximum: maxKelvin,
    step: 1,
  };
}

/** Color HSV capability (Hue 0-360, Saturation 0-100%, Value 0-100%). */
export const colorHsvCapability: Capability = {
  id: CapabilityKind.ColorHsv,
  kind: CapabilityKind.ColorHsv,
  readable: true,
  operations: ['set_color_hsv'],
};

/** Temperature sensor or target capability in Celsius. */
export function createTemperatureCapability(
  id: string = CapabilityKind.Temperature,
  operations: readonly string[] = [],
): Capability {
  return {
    id,
    kind: CapabilityKind.Temperature,
    readable: true,
    operations,
    unit: '°C',
    step: 0.1,
  };
}

/** Standard door lock capability. */
export const lockCapability: Capability = {
  id: CapabilityKind.Lock,
  kind: CapabilityKind.Lock,
  readable: true,
  operations: ['lock', 'unlock'],
  choices: ['locked', 'unlocked', 'jammed', 'locking', 'unlocking'],
};

/** Standard motorized cover / blind capability. */
export const coverCapability: Capability = {
  id: CapabilityKind.Cover,
  kind: CapabilityKind.Cover,
  readable: true,
  operations: ['open', 'close', 'stop', 'set_position'],
  unit: '%',
  minimum: 0,
  maximum: 100,
  step: 1,
};

/** Motion sensor capability. */
export const motionCapability: Capability = {
  id: CapabilityKind.Motion,
  kind: CapabilityKind.Motion,
  readable: true,
  operations: [],
};

/** Contact (door/window) sensor capability. */
export const contactCapability: Capability = {
  id: CapabilityKind.Contact,
  kind: CapabilityKind.Contact,
  readable: true,
  operations: [],
};

/** First-class event capability for buttons, remotes, wall switches, and tap dials. */
export function createEventCapability(eventTypes: readonly string[]): Capability {
  return {
    id: CapabilityKind.Event,
    kind: CapabilityKind.Event,
    readable: true,
    operations: [],
    choices: eventTypes,
  };
}

/** First-class update capability for firmware and apps/add-on upgrades. */
export const updateCapability: Capability = {
  id: CapabilityKind.Update,
  kind: CapabilityKind.Update,
  readable: true,
  operations: ['install'],
};

// --- Unit Conversion Helpers ---

/** Converts Kelvin to HomeKit Mireds (1,000,000 / K) with bounds clamping. */
export function kelvinToMireds(kelvin: number): number {
  if (kelvin <= 0) return 500;
  const mireds = Math.round(1_000_000 / kelvin);
  return Math.min(500, Math.max(140, mireds));
}

/** Converts HomeKit Mireds to absolute Kelvin (1,000,000 / Mireds). */
export function miredsToKelvin(mireds: number): number {
  if (mireds <= 0) return 6500;
  return Math.round(1_000_000 / mireds);
}

/** Normalizes HSV color values within standard ranges. */
export function normalizeHsv(
  hue: number,
  saturation: number,
  value: number,
): { hue: number; saturation: number; value: number } {
  const normHue = ((Math.round(hue) % 360) + 360) % 360;
  const normSat = Math.min(100, Math.max(0, Math.round(saturation)));
  const normVal = Math.min(100, Math.max(0, Math.round(value)));
  return { hue: normHue, saturation: normSat, value: normVal };
}

/** Converts Celsius to Fahrenheit with 1-decimal precision. */
export function celsiusToFahrenheit(celsius: number): number {
  return Math.round(((celsius * 9) / 5 + 32) * 10) / 10;
}

/** Converts Fahrenheit to Celsius with 1-decimal precision. */
export function fahrenheitToCelsius(fahrenheit: number): number {
  return Math.round((((fahrenheit - 32) * 5) / 9) * 10) / 10;
}

/** Converts Hue (0-360) and Saturation (0-100) at full value to RGB (0-255). */
export function hsToRgb(h: number, s: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const c = sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = 1 - c;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hue < 60) [r1, g1, b1] = [c, x, 0];
  else if (hue < 120) [r1, g1, b1] = [x, c, 0];
  else if (hue < 180) [r1, g1, b1] = [0, c, x];
  else if (hue < 240) [r1, g1, b1] = [0, x, c];
  else if (hue < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/** Converts RGB (0-255) to Hue (0-360) and Saturation (0-100). */
export function rgbToHs(r: number, g: number, b: number): { h: number; s: number } {
  const rn = Math.max(0, Math.min(255, r)) / 255;
  const gn = Math.max(0, Math.min(255, g)) / 255;
  const bn = Math.max(0, Math.min(255, b)) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : Math.round((d / max) * 100);
  return { h, s };
}
