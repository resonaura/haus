/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveHubBrandIcon, sanitizeBrandIconHint } from '../management/hub-brand-icons';

const SAMPLE_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2eoAAAAASUVORK5CYII=';

describe('desktop hub brand icons bridge', () => {
  it('sanitizes IPC hints and resolves from Hub /api/brands/icon with query encoding for scoped IDs', async () => {
    const owner = {};
    const apiGet = vi.fn(async (path: string) => {
      if (path.includes('/api/brands/icon?')) {
        return { dataUri: SAMPLE_PNG_DATA_URI };
      }
      return null;
    });

    const hint = sanitizeBrandIconHint({
      name: '  Tuya Bridge  ',
      supportedBy: 'tuya',
      repositoryUrl: 'https://github.com/resonaura/scrypted-tuya',
      extraUnsafeField: 123,
    });
    expect(hint).toEqual({
      name: 'Tuya Bridge',
      supportedBy: 'tuya',
      repositoryUrl: 'https://github.com/resonaura/scrypted-tuya',
    });

    const first = await resolveHubBrandIcon(
      owner,
      apiGet,
      'plugin',
      '@scrypted/amcrest',
      true,
      hint,
    );
    const second = await resolveHubBrandIcon(
      owner,
      apiGet,
      'plugin',
      '@scrypted/amcrest',
      true,
      hint,
    );
    expect(first).toBe(SAMPLE_PNG_DATA_URI);
    expect(second).toBe(SAMPLE_PNG_DATA_URI);
    expect(apiGet).toHaveBeenCalledTimes(1);
    const calledPath = apiGet.mock.calls[0]?.[0] ?? '';
    expect(calledPath).toContain('kind=plugin');
    expect(calledPath).toContain('id=%40scrypted%2Famcrest');
    expect(calledPath).toContain('dark=1');
  });

  it('falls back cleanly when talking to an older Hub without /api/brands/icon', async () => {
    const owner = {};
    const apiGet = vi.fn(async () => {
      throw new Error('404 Not Found');
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('offline', { status: 404 })) as typeof fetch;
    try {
      const result = await resolveHubBrandIcon(owner, apiGet, 'app', 'aqara-cameras', false);
      expect(result?.startsWith('data:image/svg+xml;base64,')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
