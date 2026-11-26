/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface TerminalPalette {
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly cursorAccent: string;
  readonly selectionBackground: string;
  readonly scrollbarThumb: string;
  readonly matchBackground: string;
  readonly matchBorder: string;
  readonly activeMatchBackground: string;
  readonly activeMatchForeground: string;
  readonly ansi16: readonly string[];
}

const DARK_ANSI_16: readonly string[] = [
  '#242424', // 0 black
  '#ff4245', // 1 red
  '#34c759', // 2 green
  '#ffd600', // 3 yellow
  '#369aff', // 4 blue
  '#ca71f0', // 5 magenta
  '#5ac8fa', // 6 cyan
  '#e5e5e5', // 7 white
  '#808080', // 8 brightBlack
  '#ff696b', // 9 brightRed
  '#6cdb89', // 10 brightGreen
  '#ffe572', // 11 brightYellow
  '#69b6ff', // 12 brightBlue
  '#e49dff', // 13 brightMagenta
  '#92dcff', // 14 brightCyan
  '#ffffff', // 15 brightWhite
];

const LIGHT_ANSI_16: readonly string[] = [
  '#171717', // 0 black
  '#ff383c', // 1 red
  '#34c759', // 2 green
  '#b88600', // 3 yellow
  '#369aff', // 4 blue
  '#ca71f0', // 5 magenta
  '#5ac8fa', // 6 cyan
  '#555555', // 7 white
  '#808080', // 8 brightBlack
  '#ff696b', // 9 brightRed
  '#6cdb89', // 10 brightGreen
  '#ffe572', // 11 brightYellow
  '#69b6ff', // 12 brightBlue
  '#e49dff', // 13 brightMagenta
  '#92dcff', // 14 brightCyan
  '#111111', // 15 brightWhite
];

const XTERM_CUBE_STEPS = [0, 95, 135, 175, 215, 255] as const;

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function buildXterm256Tail(): readonly string[] {
  const out: string[] = [];
  // 16..231: 6x6x6 RGB cube
  for (let i = 0; i < 216; i++) {
    const r = XTERM_CUBE_STEPS[Math.floor(i / 36)] ?? 0;
    const g = XTERM_CUBE_STEPS[Math.floor((i % 36) / 6)] ?? 0;
    const b = XTERM_CUBE_STEPS[i % 6] ?? 0;
    out.push(`#${hex2(r)}${hex2(g)}${hex2(b)}`);
  }
  // 232..255: 24-step grayscale ramp
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    out.push(`#${hex2(v)}${hex2(v)}${hex2(v)}`);
  }
  return out;
}

const XTERM_256_TAIL = buildXterm256Tail();

/** Returns the exact Electron 1:1 dark or light terminal palette. */
export function resolveTerminalPalette(mode: 'dark' | 'light'): TerminalPalette {
  const dark = mode === 'dark';
  return {
    background: dark ? '#000000' : '#ffffff',
    foreground: dark ? '#ffffff' : '#161616',
    cursor: dark ? '#ffffff' : '#111111',
    cursorAccent: dark ? '#000000' : '#ffffff',
    selectionBackground: dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.16)',
    scrollbarThumb: dark ? 'rgba(255, 255, 255, 0.26)' : 'rgba(0, 0, 0, 0.22)',
    matchBackground: '#ff923055',
    matchBorder: '#ff9230',
    activeMatchBackground: '#ff9230',
    activeMatchForeground: '#101010',
    ansi16: dark ? DARK_ANSI_16 : LIGHT_ANSI_16,
  };
}

export function resolvePaletteIndex(index: number, palette: TerminalPalette): string {
  if (index >= 0 && index < 16) return palette.ansi16[index] ?? palette.foreground;
  if (index >= 16 && index < 256) return XTERM_256_TAIL[index - 16] ?? palette.foreground;
  return palette.foreground;
}

export function rgbIntToCss(rgb: number): string {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}
