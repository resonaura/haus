/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveCandidateDomains, validateBrandIconInput } from '../src/native/brand-fallbacks.js';
import { BrandIconCache, resolveBrandIcon } from '../src/native/brand-icons.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2eoAAAAASUVORK5CYII=',
  'base64',
);

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('brand-icons resolver', () => {
  it('validates allowed kinds and rejects path traversal or unsafe IDs', () => {
    expect(validateBrandIconInput('integration', 'tuya')).toEqual({
      kind: 'integration',
      id: 'tuya',
    });
    expect(validateBrandIconInput('plugin', '@scrypted/amcrest')).toEqual({
      kind: 'plugin',
      id: '@scrypted/amcrest',
    });
    expect(validateBrandIconInput('hacs', 'AlexxIT/SonoffLAN')).toEqual({
      kind: 'hacs',
      id: 'AlexxIT/SonoffLAN',
    });
    expect(() => validateBrandIconInput('unknown', 'tuya')).toThrow('Invalid brand icon.');
    expect(() => validateBrandIconInput('integration', '../secret')).toThrow('Invalid brand icon.');
    expect(() => validateBrandIconInput('integration', 'tuya?foo=1')).toThrow(
      'Invalid brand icon.',
    );
  });

  it('derives alias candidates for apps, addons, scoped packages, and supported_by', () => {
    expect(deriveCandidateDomains('app', 'tuya-rtsp-bridge')).toContain('tuya');
    expect(deriveCandidateDomains('addon', 'a0d7b954_zigbee2mqtt')).toContain('zigbee2mqtt');
    expect(deriveCandidateDomains('addon', 'core_mosquitto')).toContain('mqtt');
    expect(deriveCandidateDomains('plugin', '@scrypted/amcrest')).toEqual(
      expect.arrayContaining(['amcrest', 'dahua', 'scrypted']),
    );
    expect(
      deriveCandidateDomains('integration', 'xiaomi_brand', { supportedBy: 'xiaomi_miio' }),
    ).toContain('xiaomi_miio');
  });

  it('prefers local custom component icons and honors supported_by in local manifest.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-brands-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'custom_cam'), { recursive: true });
    await writeFile(join(dir, 'custom_cam', 'icon.png'), TINY_PNG);

    const fetchMock = vi.fn(async () => new Response('missing', { status: 404 }));
    const uri = await resolveBrandIcon({
      kind: 'integration',
      id: 'custom_cam',
      localIntegrationDirs: [dir],
      fetchFn: fetchMock,
    });

    expect(uri).toBe(`data:image/png;base64,${TINY_PNG.toString('base64')}`);
    expect(fetchMock).not.toHaveBeenCalled();

    await mkdir(join(dir, 'virtual_brand'), { recursive: true });
    await writeFile(
      join(dir, 'virtual_brand', 'manifest.json'),
      JSON.stringify({ domain: 'virtual_brand', supported_by: 'custom_cam' }),
    );
    const virtualUri = await resolveBrandIcon({
      kind: 'integration',
      id: 'virtual_brand',
      localIntegrationDirs: [dir],
      fetchFn: fetchMock,
    });
    expect(virtualUri).toBe(`data:image/png;base64,${TINY_PNG.toString('base64')}`);
  });

  it('falls back across dark -> light -> logo on upstream brands and authenticates only to HA origin', async () => {
    const seenAuth: Array<{ url: string; auth: string | null }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const headers = new Headers(init?.headers);
      seenAuth.push({ url, auth: headers.get('authorization') });
      if (url.endsWith('/tuya/logo.png')) {
        return new Response(TINY_PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    const uri = await resolveBrandIcon({
      kind: 'app',
      id: 'tuya-rtsp-bridge',
      dark: true,
      haSession: {
        url: 'http://ha.local:8123',
        getAccessToken: async () => 'secret-token',
      },
      fetchFn: fetchMock,
    });

    expect(uri).toBe(`data:image/png;base64,${TINY_PNG.toString('base64')}`);
    for (const entry of seenAuth) {
      if (entry.url.startsWith('http://ha.local:8123')) {
        expect(entry.auth).toBe('Bearer secret-token');
      } else {
        expect(entry.auth).toBeNull();
      }
    }
  });

  it('resolves store addon icon when installed addon endpoint returns 404', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/api/hassio/store/addons/core_mosquitto/icon')) {
        return new Response(TINY_PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('missing', { status: 404 });
    });

    const uri = await resolveBrandIcon({
      kind: 'addon',
      id: 'core_mosquitto',
      haSession: {
        url: 'http://ha.local:8123',
        getAccessToken: async () => 'ha-token',
      },
      fetchFn: fetchMock,
    });

    expect(uri).toBe(`data:image/png;base64,${TINY_PNG.toString('base64')}`);
  });

  it('falls back to HACS/GitHub avatar and finally bundled vector SVG when offline', async () => {
    const githubMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === 'https://github.com/krahabb.png?size=128') {
        return new Response(TINY_PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('missing', { status: 404 });
    });

    const githubUri = await resolveBrandIcon({
      kind: 'hacs',
      id: 'meross_lan',
      hint: { repositoryUrl: 'https://github.com/krahabb/meross_lan' },
      fetchFn: githubMock,
    });
    expect(githubUri).toBe(`data:image/png;base64,${TINY_PNG.toString('base64')}`);

    const offlineMock = vi.fn(async () => {
      throw new Error('offline');
    });
    const svgUri = await resolveBrandIcon({
      kind: 'app',
      id: 'aqara-cameras',
      fetchFn: offlineMock,
      cache: new BrandIconCache(),
    });
    expect(svgUri?.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const decoded = Buffer.from(svgUri!.split(',')[1]!, 'base64').toString('utf8');
    expect(decoded).toContain('<svg');
    expect(decoded).not.toContain('-apple-system');
  });

  it('resolves HA brand/ subfolders, octet-stream PNGs, Homebridge plugins, and Scrypted plugins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-plugins-'));
    tempDirs.push(dir);

    // HA 2026.3+ local brand/ folder
    await mkdir(join(dir, 'custom_comp', 'brand'), { recursive: true });
    await writeFile(join(dir, 'custom_comp', 'brand', 'dark_icon.png'), TINY_PNG);

    // Local Homebridge plugin with declared package.json icon
    const localPluginDir = join(dir, 'node_modules');
    await mkdir(join(localPluginDir, 'homebridge-demo', 'branding'), { recursive: true });
    await writeFile(
      join(localPluginDir, 'homebridge-demo', 'package.json'),
      JSON.stringify({ name: 'homebridge-demo', homebridge: { icon: 'branding/icon.png' } }),
    );
    await writeFile(join(localPluginDir, 'homebridge-demo', 'branding', 'icon.png'), TINY_PNG);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/api/hassio/addons/a0d7b954_zigbee2mqtt/icon')) {
        return new Response(TINY_PNG, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      if (url.includes('/api/hassio/addons/bad_html/icon')) {
        return new Response('<html>not an image</html>', {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      if (
        url === 'https://raw.githubusercontent.com/koush/scrypted/HEAD/plugins/reolink/icon.png'
      ) {
        return new Response(TINY_PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      if (url === 'https://cdn.jsdelivr.net/npm/%40acme/scrypted-cam/package.json') {
        return new Response(
          JSON.stringify({ name: '@acme/scrypted-cam', scrypted: { icon: 'assets/cam.png' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url === 'https://cdn.jsdelivr.net/npm/%40acme/scrypted-cam/assets/cam.png') {
        return new Response(TINY_PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('missing', { status: 404 });
    });

    const expectedPng = `data:image/png;base64,${TINY_PNG.toString('base64')}`;

    expect(
      await resolveBrandIcon({
        kind: 'integration',
        id: 'custom_comp',
        dark: true,
        localIntegrationDirs: [dir],
        fetchFn: fetchMock,
      }),
    ).toBe(expectedPng);

    expect(
      await resolveBrandIcon({
        kind: 'homebridge',
        id: 'homebridge-demo',
        localPluginDirs: [localPluginDir],
        fetchFn: fetchMock,
      }),
    ).toBe(expectedPng);

    expect(
      await resolveBrandIcon({
        kind: 'addon',
        id: 'a0d7b954_zigbee2mqtt',
        haSession: { url: 'http://ha.local:8123', getAccessToken: async () => 'tok' },
        fetchFn: fetchMock,
      }),
    ).toBe(expectedPng);

    const rejectedHtml = await resolveBrandIcon({
      kind: 'addon',
      id: 'bad_html',
      allowFallback: false,
      haSession: { url: 'http://ha.local:8123', getAccessToken: async () => 'tok' },
      fetchFn: fetchMock,
    });
    expect(rejectedHtml).toBeNull();

    expect(
      await resolveBrandIcon({
        kind: 'scrypted',
        id: '@scrypted/reolink',
        fetchFn: fetchMock,
      }),
    ).toBe(expectedPng);

    expect(
      await resolveBrandIcon({
        kind: 'scrypted',
        id: '@acme/scrypted-cam',
        fetchFn: fetchMock,
      }),
    ).toBe(expectedPng);
  });
});
