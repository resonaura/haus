/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import type { AppManifest } from '@haus/apps';
import { AppAccessories } from '../../src/providers/accessories.js';
import type { NativeProviders, NativeProviderInventory } from '../../src/providers/native.js';

const bridgeId = '88888888-1111-2222-3333-444444444444';
const manifest: AppManifest = {
  id: 'fixture',
  name: 'Fixture',
  version: '1',
  image: 'fixture:1',
  architectures: ['amd64'],
  network: { mode: 'host' },
  accessories: { protocol: 'haus-camera-v2', port: 8580 },
};

function fixture() {
  let imported = false;
  const connections: ReturnType<NativeProviders['connections']> = [];
  const inventory: NativeProviderInventory = {
    bridgeId,
    provider: 'aqara',
    revision: 'a'.repeat(64),
    cameras: [],
  };
  const home = { appAccessoryManifest: vi.fn(async () => manifest) };
  const local = vi.fn(async (_port: number, path: string) =>
    path.endsWith('info') ? { version: 2, bridgeId, provider: 'aqara' } : { code: 'b'.repeat(48) },
  );
  const providers = {
    connections: () => connections,
    refresh: vi.fn(async () => inventory),
    add: vi.fn(async () => {
      connections.push({
        id: bridgeId,
        connection: { bridgeId, provider: 'aqara', endpoint: { url: 'http://192.168.1.10:8580' } },
      });
      return {
        id: bridgeId,
        provider: 'aqara',
        available: true,
        cameras: 1,
        url: 'http://192.168.1.10:8580',
      };
    }),
  };
  const sources = {
    preview: vi.fn(() => [
      {
        physicalId: 'physical-1',
        name: 'Camera',
        available: true,
        existingCameraId: 'camera.preserved',
        imported,
      },
    ]),
    import: vi.fn(async () => {
      imported = true;
      return [];
    }),
  };
  const registry = { cameras: [{ id: 'camera.preserved', aliases: ['camera.original'] }] };
  return {
    home,
    local,
    providers,
    sources,
    registry,
    accessories: new AppAccessories(
      home,
      providers,
      sources,
      () => registry,
      local,
      () => '192.168.1.10',
    ),
  };
}

it('connects a declared App privately, imports once and preserves the identity registry', async () => {
  const f = fixture();
  expect(await f.accessories.read('admin', 'app-1')).toEqual({ connected: false, cameras: [] });
  await f.accessories.sync('admin', 'app-1');
  expect(f.providers.add).toHaveBeenCalledWith(
    { url: 'http://192.168.1.10:8580', allowHttp: true, code: 'b'.repeat(48) },
    { bridgeId, provider: 'aqara', port: 8580 },
  );
  expect(f.sources.import).toHaveBeenCalledWith(bridgeId, ['physical-1'], f.registry);
  await f.accessories.sync('admin', 'app-1');
  expect(f.providers.add).toHaveBeenCalledTimes(1);
  expect(f.sources.import).toHaveBeenCalledTimes(1);
});

it('does not contact or enroll an App when authorization or capability lookup fails', async () => {
  const f = fixture();
  f.home.appAccessoryManifest.mockRejectedValueOnce(Error('app_permission_denied'));
  await expect(f.accessories.sync('guest', 'app-1')).rejects.toThrow('app_permission_denied');
  expect(f.local).not.toHaveBeenCalled();
  f.home.appAccessoryManifest.mockResolvedValueOnce({ ...manifest, accessories: undefined });
  await expect(f.accessories.sync('admin', 'app-1')).rejects.toThrow('app_accessories_unsupported');
  expect(f.providers.add).not.toHaveBeenCalled();
});
