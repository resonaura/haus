/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export function rewritePlaylist(
  text: string,
  base: string,
  convert: (url: string) => string = (url) => url,
): string {
  const resolve = (value: string) => {
    try {
      return convert(new URL(value, base).href);
    } catch {
      const normalizedBase = base.endsWith('/') ? base : `${base}/`;
      return convert(`${normalizedBase}${value.replace(/^\.\//, '')}`);
    }
  };

  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${resolve(uri)}"`);
      }
      return line.trim() ? resolve(line.trim()) : line;
    })
    .join('\n');
}
