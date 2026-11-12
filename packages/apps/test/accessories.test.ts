/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { appAccessoryPort, appAccessorySupport } from '../src/accessories.js';
import { validateAppManifest, type AppManifest } from '../src/manifest.js';

const manifest: AppManifest = {
  id: 'camera-app',
  name: 'Camera App',
  version: '1',
  image: 'fixture:1',
  architectures: ['amd64'],
  network: { mode: 'host' },
  accessories: { protocol: 'haus-camera-v2', port: 8580 },
};

it('uses declared App capabilities without inferring authority from a display name', () => {
  expect(validateAppManifest(manifest).valid).toBe(true);
  expect(appAccessoryPort(manifest)).toBe(8580);
  expect(appAccessorySupport(manifest)).toEqual({ camera: true, mqtt: false });
  expect(
    appAccessorySupport({ ...manifest, accessories: undefined, services: ['mqtt:want'] }),
  ).toEqual({ camera: false, mqtt: true });
  expect(appAccessoryPort({ ...manifest, accessories: undefined, name: 'Aqara' })).toBeUndefined();
  expect(
    validateAppManifest({ ...manifest, accessories: { protocol: 'haus-camera-v2', port: 0 } })
      .valid,
  ).toBe(false);
  expect(
    validateAppManifest({
      ...manifest,
      accessories: { ...manifest.accessories, host: 'untrusted' },
    }).valid,
  ).toBe(false);
});

it('requires a published TCP endpoint for isolated Docker networks', () => {
  expect(
    appAccessoryPort({
      ...manifest,
      network: { mode: 'bridge' },
      ports: [{ containerPort: 8580, hostPort: 18580 }],
    }),
  ).toBe(18580);
  expect(() => appAccessoryPort({ ...manifest, network: { mode: 'bridge' } })).toThrow(
    'app_accessories_port_unpublished',
  );
  expect(() => appAccessoryPort({ ...manifest, network: { mode: 'internal' } })).toThrow(
    'app_accessories_network_unavailable',
  );
});
