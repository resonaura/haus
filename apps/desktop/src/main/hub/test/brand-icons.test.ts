/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  clearHubBrandIconCaches,
  probeHubBrandIconVersion,
  resolveHubBrandIcon,
  resolveHubBrandIconTile,
  sanitizeBrandIconHint,
} from '../management/hub-brand-icons';

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

  it('requests pre-rendered GNOME styled tiles from Hub and caches by variant + tint', async () => {
    const owner = {};
    const apiGet = vi.fn(async (path: string) => {
      if (path.includes('appearance=tinted')) {
        return {
          dataUri: SAMPLE_PNG_DATA_URI,
          rendered: true,
          layout: 'inset',
          revision: 'v3-gnome-v1',
        };
      }
      return null;
    });

    const first = await resolveHubBrandIconTile(
      owner,
      apiGet,
      'addon',
      'core_mosquitto',
      { appearance: 'tinted', variation: 'dark', tintHex: '#bf5af2', size: 44 },
      { repository: 'core', addonSlug: 'core_mosquitto' },
    );
    const second = await resolveHubBrandIconTile(
      owner,
      apiGet,
      'addon',
      'core_mosquitto',
      { appearance: 'tinted', variation: 'dark', tintHex: '#bf5af2', size: 44 },
      { repository: 'core', addonSlug: 'core_mosquitto' },
    );

    expect(first).toEqual({
      dataUri: SAMPLE_PNG_DATA_URI,
      rendered: true,
      layout: 'inset',
      revision: 'v3-gnome-v1',
    });
    expect(second).toEqual(first);
    expect(apiGet).toHaveBeenCalledTimes(1);
    const url = apiGet.mock.calls[0]?.[0] ?? '';
    expect(url).toContain('appearance=tinted');
    expect(url).toContain('variation=dark');
    expect(url).toContain('tint=%23bf5af2');
    expect(url).toContain('repository=core');
  });

  it('invalidates cached tiles and notifies renderer when Hub icon cache version rolls over', async () => {
    const owner = {};
    const emit = vi.fn();
    let hubRevision = 'v3-gnome-v3-cpp-11111111';
    const v1Uri = SAMPLE_PNG_DATA_URI;
    const v2Uri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAADZc7J/AAAADklEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const apiGet = vi.fn(async (path: string) => {
      if (path === '/api/brands/status') {
        return { version: hubRevision };
      }
      if (path.includes('/api/brands/icon?')) {
        return {
          dataUri: hubRevision.includes('v3-gnome-v3') ? v1Uri : v2Uri,
          rendered: true,
          layout: 'inset',
          revision: hubRevision,
        };
      }
      return null;
    });

    await probeHubBrandIconVersion(owner, apiGet, emit);
    const first = await resolveHubBrandIconTile(
      owner,
      apiGet,
      'integration',
      'hue',
      { appearance: 'default', variation: 'dark', size: 44 },
      undefined,
      emit,
    );
    expect(first?.dataUri).toBe(v1Uri);
    expect(emit).not.toHaveBeenCalled();

    // Hub upgrades to a new engine fingerprint and reports the new version on reconnect.
    hubRevision = 'v3-gnome-v4-cpp-22222222';
    await probeHubBrandIconVersion(owner, apiGet, emit);
    expect(emit).toHaveBeenCalledWith({
      type: 'brand-icons-invalidated',
      version: 'v3-gnome-v4-cpp-22222222',
    });

    // Next lookup must hit the Hub instead of returning the old cached v1 tile.
    const refreshed = await resolveHubBrandIconTile(
      owner,
      apiGet,
      'integration',
      'hue',
      { appearance: 'default', variation: 'dark', size: 44 },
      undefined,
      emit,
    );
    expect(refreshed?.dataUri).toBe(v2Uri);
    expect(refreshed?.revision).toBe('v3-gnome-v4-cpp-22222222');

    // Mid-session revision rollover detected directly from a tile response also invalidates.
    hubRevision = 'v3-gnome-v4-cpp-33333333';
    const other = await resolveHubBrandIconTile(
      owner,
      apiGet,
      'integration',
      'tuya',
      { appearance: 'default', variation: 'dark', size: 44 },
      undefined,
      emit,
    );
    expect(other?.revision).toBe('v3-gnome-v4-cpp-33333333');
    expect(emit).toHaveBeenCalledWith({
      type: 'brand-icons-invalidated',
      version: 'v3-gnome-v4-cpp-33333333',
    });

    clearHubBrandIconCaches(owner, emit);
    expect(emit).toHaveBeenLastCalledWith({ type: 'brand-icons-invalidated', version: '' });
  });
});
