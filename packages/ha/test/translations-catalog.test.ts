/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DynamicCatalogService,
  HaCatalogTranslations,
  parseHomeAssistantWheel,
} from '../src/catalog/index.js';

function buildStoredZip(entries: Record<string, string>): Buffer {
  const localChunks: Buffer[] = [];
  const cdChunks: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, nameBuf, dataBuf);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt32LE(offset, 42);
    cdChunks.push(cd, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const cdBuf = Buffer.concat(cdChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, cdBuf, eocd]);
}

describe('HaCatalogTranslations & PyPI wheel refresh', () => {
  it('loads bundled 2024.12.5 translations, supported_by, homekit models, and flow handlers', () => {
    const tr = HaCatalogTranslations.fromFile(resolve('data/ha-translations-2024.12.5.json.gz'));
    expect(Object.keys(tr.getIndex().translations).length).toBeGreaterThanOrEqual(840);
    expect(tr.resolveSupportedBy('3_day_blinds')).toBe('motion_blinds');
    expect(tr.hasFlowHandler('3_day_blinds')).toBe(true);
    expect(tr.hasFlowHandler('ipp')).toBe(true);
    expect(tr.getHomeKitModelInfo('BSB002')).toEqual({ domain: 'hue', alwaysDiscover: false });
    expect(tr.getHomeKitModelInfo('HHKBridge123')).toEqual({
      domain: 'hive',
      alwaysDiscover: true,
    });

    const flat = tr.getFlattenedCategory('config', ['ipp']);
    expect(flat['component.ipp.config.step.user.data.host']).toBeDefined();
    expect(tr.getIntegrationTitle('nest')).toBe('Google Nest');
  });

  it('extracts manifests and translations from a wheel buffer and refreshes DynamicCatalogService atomically', async () => {
    const wheelEntries: Record<string, string> = {};
    for (let i = 0; i < 510; i += 1) {
      const dom = i === 0 ? 'acme_new' : `comp_${i}`;
      wheelEntries[`homeassistant/components/${dom}/manifest.json`] = JSON.stringify({
        domain: dom,
        name: i === 0 ? 'Acme New' : `Comp ${i}`,
        config_flow: true,
        requirements: i === 0 ? ['acme-sdk==1.2.3'] : [],
        zeroconf: i === 0 ? ['_acme._tcp.local.'] : undefined,
      });
    }
    wheelEntries['homeassistant/components/acme_brand/manifest.json'] = JSON.stringify({
      domain: 'acme_brand',
      name: 'Acme Brand',
      integration_type: 'virtual',
      supported_by: 'acme_new',
    });
    wheelEntries['homeassistant/components/acme_new/translations/en.json'] = JSON.stringify({
      title: 'Acme New',
      config: { step: { user: { title: 'Connect Acme', data: { host: 'Hub Host' } } } },
    });
    wheelEntries['homeassistant/generated/zeroconf.py'] =
      'HOMEKIT = {\n  "ACME*": {\n    "always_discover": True,\n    "domain": "acme_new",\n  },\n}\n';
    wheelEntries['homeassistant/generated/config_flows.py'] =
      'FLOWS = {"integration": ["acme_new"], "helper": []}\n';

    const wheelBuf = buildStoredZip(wheelEntries);
    const parsed = parseHomeAssistantWheel(wheelBuf, '2026.11.1');
    expect(parsed.manifests['acme_new']?.name).toBe('Acme New');
    expect(parsed.translationsIndex.supportedBy['acme_brand']).toBe('acme_new');
    expect(parsed.translationsIndex.homekitModels['ACME*']).toEqual({
      domain: 'acme_new',
      alwaysDiscover: true,
    });

    const tmp = mkdtempSync(join(tmpdir(), 'haus-dyn-wheel-'));
    try {
      const mockFetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/pypi/homeassistant/')) {
          return new Response(
            JSON.stringify({
              info: { version: '2026.11.1' },
              urls: [
                {
                  packagetype: 'bdist_wheel',
                  filename: 'homeassistant-2026.11.1-py3-none-any.whl',
                  url: 'https://files.pythonhosted.org/homeassistant-2026.11.1-py3-none-any.whl',
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('.whl')) {
          return new Response(new Uint8Array(wheelBuf), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }) as typeof fetch;

      const svc = new DynamicCatalogService({
        cachePath: join(tmp, 'ha-catalog-latest.json.gz'),
        translationsCachePath: join(tmp, 'ha-translations-latest.json.gz'),
        fetchFn: mockFetch,
      });

      const refreshed = await svc.refreshCatalog('2026.11.1');
      expect(refreshed.getVersion()).toBe('2026.11.1');
      assert.equal(refreshed.getManifest('acme_new')?.name, 'Acme New');
      expect(svc.getTranslations().resolveSupportedBy('acme_brand')).toBe('acme_new');
      expect(svc.getTranslations().getIntegrationTitle('acme_brand')).toBe('Acme Brand');

      // Reload from disk cache to verify atomic persistence
      const reloaded = new DynamicCatalogService({
        cachePath: join(tmp, 'ha-catalog-latest.json.gz'),
        translationsCachePath: join(tmp, 'ha-translations-latest.json.gz'),
        fetchFn: mockFetch,
      });
      expect(reloaded.getVersion()).toBe('2026.11.1');
      expect(reloaded.getTranslations().getHomeKitModelInfo('ACME-1')).toEqual({
        domain: 'acme_new',
        alwaysDiscover: true,
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
