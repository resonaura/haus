/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type HausColorSpace = 'rgb' | 'hsl' | 'hsb';
export type HausColorChannel =
  'red' | 'green' | 'blue' | 'hue' | 'saturation' | 'brightness' | 'lightness';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rgbToHsb(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return [h, s, v];
}

function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 100) / 100;
  const vn = clamp(v, 0, 100) / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = vn - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hn < 60) [r, g, b] = [c, x, 0];
  else if (hn < 120) [r, g, b] = [x, c, 0];
  else if (hn < 180) [r, g, b] = [0, c, x];
  else if (hn < 240) [r, g, b] = [0, x, c];
  else if (hn < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hn < 60) [r, g, b] = [c, x, 0];
  else if (hn < 120) [r, g, b] = [x, c, 0];
  else if (hn < 180) [r, g, b] = [0, c, x];
  else if (hn < 240) [r, g, b] = [0, x, c];
  else if (hn < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Pure TypeScript OOP color value supporting RGB, HSL, and HSB conversions
 * across React DOM, React Native, and native Rust/C++ renderers.
 */
export class HausColor {
  private readonly r: number;
  private readonly g: number;
  private readonly b: number;
  readonly space: HausColorSpace;

  constructor(r: number, g: number, b: number, space: HausColorSpace = 'rgb') {
    this.r = Math.round(clamp(r, 0, 255));
    this.g = Math.round(clamp(g, 0, 255));
    this.b = Math.round(clamp(b, 0, 255));
    this.space = space;
  }

  toFormat(space: HausColorSpace): HausColor {
    return new HausColor(this.r, this.g, this.b, space);
  }

  getChannelValue(channel: HausColorChannel): number {
    switch (channel) {
      case 'red':
        return this.r;
      case 'green':
        return this.g;
      case 'blue':
        return this.b;
      case 'hue':
        return this.space === 'hsl'
          ? rgbToHsl(this.r, this.g, this.b)[0]
          : rgbToHsb(this.r, this.g, this.b)[0];
      case 'saturation':
        return this.space === 'hsl'
          ? rgbToHsl(this.r, this.g, this.b)[1]
          : rgbToHsb(this.r, this.g, this.b)[1];
      case 'brightness':
        return rgbToHsb(this.r, this.g, this.b)[2];
      case 'lightness':
        return rgbToHsl(this.r, this.g, this.b)[2];
    }
  }

  withChannelValue(channel: HausColorChannel, value: number): HausColor {
    if (channel === 'red') return new HausColor(value, this.g, this.b, this.space);
    if (channel === 'green') return new HausColor(this.r, value, this.b, this.space);
    if (channel === 'blue') return new HausColor(this.r, this.g, value, this.space);
    if (channel === 'lightness' || this.space === 'hsl') {
      const [h, s, l] = rgbToHsl(this.r, this.g, this.b);
      const next: [number, number, number] = [
        channel === 'hue' ? value : h,
        channel === 'saturation' ? value : s,
        channel === 'lightness' ? value : l,
      ];
      const [r, g, b] = hslToRgb(next[0], next[1], next[2]);
      return new HausColor(r, g, b, 'hsl');
    }
    const [h, s, v] = rgbToHsb(this.r, this.g, this.b);
    const next: [number, number, number] = [
      channel === 'hue' ? value : h,
      channel === 'saturation' ? value : s,
      channel === 'brightness' ? value : v,
    ];
    const [r, g, b] = hsbToRgb(next[0], next[1], next[2]);
    return new HausColor(r, g, b, 'hsb');
  }

  toString(format: 'hex' | 'rgb' | 'hsl' | 'css' = 'hex'): string {
    if (format === 'hex') {
      const hex = (n: number) => n.toString(16).padStart(2, '0');
      return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}`;
    }
    if (format === 'hsl') {
      const [h, s, l] = rgbToHsl(this.r, this.g, this.b);
      return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
    }
    return `rgb(${this.r}, ${this.g}, ${this.b})`;
  }
}

export function parseHausColor(input: string): HausColor {
  const trimmed = input.trim().toLowerCase();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(trimmed);
  if (hexMatch) {
    const raw = hexMatch[1]!;
    const full = raw.length === 3 ? `${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}` : raw;
    return new HausColor(
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
      'rgb',
    );
  }

  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/.exec(trimmed);
  if (rgbMatch) {
    return new HausColor(Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3]), 'rgb');
  }

  const hslMatch = /^hsla?\(\s*([\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%/.exec(
    trimmed,
  );
  if (hslMatch) {
    const [r, g, b] = hslToRgb(Number(hslMatch[1]), Number(hslMatch[2]), Number(hslMatch[3]));
    return new HausColor(r, g, b, 'hsl');
  }

  const hsbMatch = /^hsba?\(\s*([\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%/.exec(
    trimmed,
  );
  if (hsbMatch) {
    const [r, g, b] = hsbToRgb(Number(hsbMatch[1]), Number(hsbMatch[2]), Number(hsbMatch[3]));
    return new HausColor(r, g, b, 'hsb');
  }

  return new HausColor(243, 207, 116, 'rgb');
}
