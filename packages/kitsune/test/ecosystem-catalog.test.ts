/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppCatalog, validateAppManifest } from '@haus/apps';
import {
  computePluginTrustAndStability,
  ecosystemAppId,
  EcosystemPluginCatalog,
  formatPluginDisplayName,
  isAllowedHomebridgePlugin,
  isAllowedScryptedPlugin,
  resolvePluginVendor,
  toAppCatalogEntry,
} from '../src/catalog/ecosystem.js';

describe('EcosystemPluginCatalog (Homebridge & Scrypted libraries)', () => {
  it('generates valid kebab-case AppManifest IDs for scoped, unscoped, and long npm packages', () => {
    expect(ecosystemAppId('scrypted', '@scrypted/reolink')).toBe('scrypted-reolink');
    expect(ecosystemAppId('scrypted', 'scrypted-kasa')).toBe('scrypted-kasa');
    expect(ecosystemAppId('homebridge', 'homebridge-hue')).toBe('homebridge-hue');
    expect(ecosystemAppId('homebridge', '@0x5e/homebridge-tuya-platform')).toBe(
      'hb-0x5e-tuya-platform',
    );

    const veryLong =
      '@organization-with-a-very-long-scope/homebridge-extremely-detailed-smart-device-platform-plugin';
    const slug = ecosystemAppId('homebridge', veryLong);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)).toBe(true);
  });

  it('formats readable display titles with acronyms and brand casing', () => {
    expect(formatPluginDisplayName('scrypted', '@scrypted/unifi-protect')).toBe(
      'UniFi Protect (Scrypted)',
    );
    expect(formatPluginDisplayName('scrypted', '@scrypted/rtsp')).toBe('RTSP (Scrypted)');
    expect(formatPluginDisplayName('homebridge', 'homebridge-camera-ffmpeg')).toBe('Camera FFmpeg');
    expect(formatPluginDisplayName('homebridge', 'homebridge-lg-webos-tv')).toBe('LG webOS TV');
  });

  it('rejects forbidden SDK/server and core infrastructure packages while admitting real plugins', () => {
    expect(isAllowedScryptedPlugin('@scrypted/sdk', ['scrypted'])).toBe(false);
    expect(isAllowedScryptedPlugin('@scrypted/server', ['scrypted'])).toBe(false);
    expect(isAllowedScryptedPlugin('scrypted', ['scrypted'])).toBe(false);
    expect(isAllowedScryptedPlugin('@scrypted/core', ['scrypted'])).toBe(false);
    expect(isAllowedScryptedPlugin('@scrypted/nvr', ['scrypted'])).toBe(false);
    expect(isAllowedScryptedPlugin('@scrypted/reolink', ['scrypted'])).toBe(true);
    expect(isAllowedScryptedPlugin('scrypted-kasa', ['scrypted'])).toBe(true);

    expect(isAllowedHomebridgePlugin('homebridge', ['homebridge-plugin'])).toBe(false);
    expect(isAllowedHomebridgePlugin('homebridge-config-ui-x', ['homebridge-plugin'])).toBe(false);
    expect(isAllowedHomebridgePlugin('homebridge-hue', ['homebridge-plugin'])).toBe(true);
  });

  it('indexes npm search pages, verified lists, and live queries and syncs valid manifests into AppCatalog', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-eco-cat-'));
    try {
      const mockFetch: typeof fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('verified-plugins.json')) {
          return new Response(
            JSON.stringify(['homebridge-hue', '@0x5e/homebridge-tuya-platform']),
            { status: 200 },
          );
        }
        if (url.includes('keywords:scrypted') || url.includes('%40scrypted%2F')) {
          return new Response(
            JSON.stringify({
              total: 3,
              objects: [
                {
                  package: {
                    name: '@scrypted/sdk',
                    version: '0.1.0',
                    keywords: ['scrypted'],
                  },
                },
                {
                  package: {
                    name: '@scrypted/hikvision',
                    version: '0.0.50',
                    description: 'Hikvision camera plugin',
                    keywords: ['scrypted'],
                    publisher: { username: 'koush' },
                  },
                },
                {
                  package: {
                    name: 'scrypted-kasa',
                    version: '0.1.4',
                    description: 'TP-Link Kasa camera & switch plugin',
                    keywords: ['scrypted'],
                    publisher: { username: 'community' },
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes('keywords:homebridge-plugin')) {
          return new Response(
            JSON.stringify({
              total: 2,
              objects: [
                {
                  package: {
                    name: '@0x5e/homebridge-tuya-platform',
                    version: '1.7.0',
                    description: 'Tuya platform for Homebridge',
                    keywords: ['homebridge-plugin'],
                    publisher: { username: '0x5e' },
                  },
                },
                {
                  package: {
                    name: 'homebridge-sonos-multiroom',
                    version: '2.3.1',
                    description: 'Sonos speakers plugin',
                    keywords: ['homebridge-plugin'],
                    publisher: { username: 'sonosdev' },
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response('not found', { status: 404 });
      }) as typeof fetch;

      const eco = new EcosystemPluginCatalog(dir, mockFetch);
      await eco.refresh(true);

      // Blocked @scrypted/sdk must never be admitted
      expect(eco.getByPackage('@scrypted/sdk')).toBeUndefined();

      const hik = eco.getByPackage('@scrypted/hikvision');
      expect(hik).toBeDefined();
      expect(hik?.id).toBe('scrypted-hikvision');
      expect(hik?.version).toBe('0.0.50');
      expect(hik?.verified).toBe(true);

      const tuyaHb = eco.getByPackage('@0x5e/homebridge-tuya-platform');
      expect(tuyaHb).toBeDefined();
      expect(tuyaHb?.id).toBe('hb-0x5e-tuya-platform');
      expect(tuyaHb?.verified).toBe(true);

      // Verify live search
      const liveResults = await eco.searchLive('sonos', 'homebridge');
      expect(liveResults.some((item) => item.packageName === 'homebridge-sonos-multiroom')).toBe(
        true,
      );

      // Sync into AppCatalog and validate every generated manifest
      const appCatalog = AppCatalog.createDefaultCatalog();
      const synced = eco.syncIntoAppCatalog(appCatalog);
      expect(synced).toBeGreaterThan(20);

      for (const record of eco.list()) {
        const entry = toAppCatalogEntry(record);
        const validation = validateAppManifest(entry.manifest);
        expect(validation.valid, `Invalid manifest for ${record.packageName}`).toBe(true);
      }

      // Disk cache reload
      const reloaded = new EcosystemPluginCatalog(dir);
      expect(await reloaded.loadDiskCache()).toBe(true);
      expect(reloaded.getByPackage('homebridge-sonos-multiroom')?.version).toBe('2.3.1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves vendor identities (including Haus Govee) and computes trust/stability tiers', () => {
    expect(resolvePluginVendor('homebridge-govee', 'Homebridge Govee')).toEqual({
      vendorId: 'govee',
      vendorName: 'Haus Govee',
    });
    expect(resolvePluginVendor('@scrypted/reolink', 'Reolink (Scrypted)')).toEqual({
      vendorId: 'reolink',
      vendorName: 'Reolink',
    });

    const verifiedTier = computePluginTrustAndStability({
      verified: true,
      featured: true,
      officialScope: true,
      score: { final: 0.85, detail: { popularity: 0.8, quality: 0.9, maintenance: 0.85 } },
    });
    const obscureTier = computePluginTrustAndStability({
      verified: false,
      featured: false,
      officialScope: false,
      score: { final: 0.18, detail: { popularity: 0.05, quality: 0.3, maintenance: 0.2 } },
    });

    expect(verifiedTier.stabilityTier).toBe('gold');
    expect(verifiedTier.trustScore).toBeGreaterThanOrEqual(90);
    expect(obscureTier.stabilityTier).toBe('low');
    expect(obscureTier.trustScore).toBeLessThan(50);
  });
});
