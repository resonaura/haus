/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import matter from '../assets/brands/matter.svg?raw';
import thread from '../assets/brands/thread.svg?raw';

/** Prefer source geometry to enlarging the server's small protocol thumbnails. */
export function protocolArtwork(kind: 'integration' | 'addon', id: string): string | null {
  const svg =
    kind === 'integration' && id === 'thread'
      ? thread
      : (kind === 'integration' && id === 'matter') ||
          (kind === 'addon' && id === 'core_matter_server')
        ? matter
        : null;
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
}
