/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AppCatalog,
  AppImageAcquirer,
  AppImageAcquisitionError,
  assessAppPermissions,
  isMutableImageTag,
  validateAppManifest,
  type AppManifest,
  type DockerImageEngine,
  type DockerImageInspection,
} from '../src/index.js';

function makeImage(id: string): DockerImageInspection {
  return {
    id,
    os: 'linux',
    architecture: 'amd64',
    repoDigests: [`ghcr.io/resonaura/tuya-rtsp-bridge@${id}`],
  };
}

describe('Tuya RTSP Bridge Catalog & Mutable Image Acquisition', () => {
  it('registers tuya-rtsp-bridge with valid manifest and explicit network:host consent', () => {
    const catalog = AppCatalog.createDefaultCatalog();
    const entry = catalog.get('tuya-rtsp-bridge');
    expect(entry).toBeDefined();
    expect(entry?.runtimeType).toBe('docker');
    expect(entry?.manifest.image).toBe('ghcr.io/resonaura/tuya-rtsp-bridge:latest');
    expect(entry?.manifest.network).toEqual({ mode: 'host' });
    expect(entry?.manifest.mounts).toEqual([{ target: 'data', containerPath: '/data' }]);

    const validation = validateAppManifest(entry!.manifest);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    const denied = assessAppPermissions(entry!.manifest, []);
    expect(denied.allowed).toBe(false);
    expect(denied.missingPermissions).toEqual(['network:host']);

    const granted = assessAppPermissions(entry!.manifest, ['network:host']);
    expect(granted.allowed).toBe(true);
    expect(granted.missingPermissions).toEqual([]);
  });

  it('classifies mutable :latest/untagged vs pinned/digest image references accurately', () => {
    expect(isMutableImageTag('ghcr.io/resonaura/tuya-rtsp-bridge:latest')).toBe(true);
    expect(isMutableImageTag('ghcr.io/resonaura/tuya-rtsp-bridge')).toBe(true);
    expect(isMutableImageTag('localhost:5000/my-bridge')).toBe(true);
    expect(isMutableImageTag('localhost:5000/my-bridge:latest')).toBe(true);
    expect(isMutableImageTag('ghcr.io/haus-home/aqara-cameras:1.3.0')).toBe(false);
    expect(
      isMutableImageTag('ghcr.io/resonaura/tuya-rtsp-bridge:latest@sha256:' + 'a'.repeat(64)),
    ).toBe(false);
  });

  it('pulls :latest from registry even when a cached local :latest exists', async () => {
    const staleId = 'sha256:' + '1'.repeat(64);
    const freshId = 'sha256:' + '2'.repeat(64);
    let current = makeImage(staleId);

    const engine: DockerImageEngine = {
      getHostPlatform: vi.fn(async () => ({ os: 'linux', architecture: 'x86_64' })),
      inspectImage: vi.fn(async () => current),
      pullImage: vi.fn(async () => {
        current = makeImage(freshId);
      }),
      buildImage: vi.fn(async () => {}),
    };

    const acquirer = new AppImageAcquirer(engine);
    const catalog = AppCatalog.createDefaultCatalog();
    const manifest = catalog.get('tuya-rtsp-bridge')!.manifest;

    const resolved = await acquirer.acquire(manifest);
    expect(engine.pullImage).toHaveBeenCalledTimes(1);
    expect(resolved.imageId).toBe(freshId);
    expect(resolved.source).toBe('registry');
  });

  it('falls back to compatible local :latest image when registry pull fails offline', async () => {
    const cachedId = 'sha256:' + '3'.repeat(64);
    const engine: DockerImageEngine = {
      getHostPlatform: vi.fn(async () => ({ os: 'linux', architecture: 'x86_64' })),
      inspectImage: vi.fn(async () => makeImage(cachedId)),
      pullImage: vi.fn(async () => {
        throw new Error('app_registry_image_unavailable');
      }),
      buildImage: vi.fn(async () => {}),
    };

    const acquirer = new AppImageAcquirer(engine);
    const catalog = AppCatalog.createDefaultCatalog();
    const manifest = catalog.get('tuya-rtsp-bridge')!.manifest;

    const resolved = await acquirer.acquire(manifest);
    expect(engine.pullImage).toHaveBeenCalledTimes(1);
    expect(resolved.imageId).toBe(cachedId);
    expect(resolved.source).toBe('local');
  });

  it('reuses local image without pulling when tag is pinned (non-mutable)', async () => {
    const pinnedId = 'sha256:' + '4'.repeat(64);
    const manifest: AppManifest = {
      id: 'pinned-bridge',
      name: 'Pinned Bridge',
      version: '1.0.0',
      image: 'ghcr.io/haus/fixture:1.0.0',
      description: 'Pinned tag fixture',
      architectures: ['amd64'],
    };

    const engine: DockerImageEngine = {
      getHostPlatform: vi.fn(async () => ({ os: 'linux', architecture: 'x86_64' })),
      inspectImage: vi.fn(async () => makeImage(pinnedId)),
      pullImage: vi.fn(async () => {}),
      buildImage: vi.fn(async () => {}),
    };

    const resolved = await new AppImageAcquirer(engine).acquire(manifest);
    expect(engine.pullImage).not.toHaveBeenCalled();
    expect(resolved.source).toBe('local');
  });

  it('rejects missing local image and offline registry failure with error', async () => {
    const engine: DockerImageEngine = {
      getHostPlatform: vi.fn(async () => ({ os: 'linux', architecture: 'x86_64' })),
      inspectImage: vi.fn(async () => undefined),
      pullImage: vi.fn(async () => {
        throw new Error('app_registry_image_unavailable');
      }),
      buildImage: vi.fn(async () => {}),
    };

    const acquirer = new AppImageAcquirer(engine);
    const catalog = AppCatalog.createDefaultCatalog();
    const manifest = catalog.get('tuya-rtsp-bridge')!.manifest;

    await expect(acquirer.acquire(manifest)).rejects.toBeInstanceOf(AppImageAcquisitionError);
  });
});
