/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ITheme } from '@xterm/xterm';

export function terminalTheme(): ITheme {
  const dark =
    document.documentElement.classList.contains('dark') ||
    document.documentElement.dataset.theme === 'dark';
  return {
    background: dark ? '#000000' : '#ffffff',
    foreground: dark ? '#ffffff' : '#161616',
    cursor: dark ? '#ffffff' : '#111111',
    cursorAccent: dark ? '#000000' : '#ffffff',
    selectionBackground: dark ? '#ffffff35' : '#00000025',
    black: dark ? '#242424' : '#171717',
    brightBlack: '#808080',
    red: dark ? '#ff4245' : '#ff383c',
    brightRed: '#ff696b',
    green: '#34c759',
    brightGreen: '#6cdb89',
    yellow: dark ? '#ffd600' : '#b88600',
    brightYellow: '#ffe572',
    blue: '#369aff',
    brightBlue: '#69b6ff',
    magenta: '#ca71f0',
    brightMagenta: '#e49dff',
    cyan: '#5ac8fa',
    brightCyan: '#92dcff',
    white: dark ? '#e5e5e5' : '#555555',
    brightWhite: dark ? '#ffffff' : '#111111',
  };
}
