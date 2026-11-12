/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import { AppImageAcquirer, type DockerImageEngine } from '../src/image.js';
import type { AppManifest } from '../src/manifest.js';

const digest = 'sha256:' + 'a'.repeat(64);
const manifest: AppManifest = {
  id: 'fixture-app',
  name: 'Fixture App',
  version: '1.0.0',
  image: 'ghcr.io/haus/fixture:1.0.0',
  architectures: ['amd64', 'arm64'],
  build: {
    repository: 'https://github.com/haus/fixture',
    commit: 'b'.repeat(40),
    context: 'service',
    dockerfile: 'Dockerfile',
  },
};

function createEngine() {
  const images = new Map<
    string,
    { id: string; os: string; architecture: string; repoDigests: string[] }
  >();
  const engine: DockerImageEngine = {
    getHostPlatform: vi.fn(async () => ({ os: 'linux', architecture: 'x86_64' })),
    inspectImage: vi.fn(async (reference) => images.get(reference)),
    pullImage: vi.fn(async (reference, _platform, onProgress) => {
      onProgress({ current: 2, total: 4 });
      images.set(reference, {
        id: digest,
        os: 'linux',
        architecture: 'amd64',
        repoDigests: ['ghcr.io/haus/fixture@' + digest],
      });
    }),
    buildImage: vi.fn(async (_recipe, target, onProgress) => {
      onProgress({ current: 1, total: 1 });
      images.set(target, { id: digest, os: 'linux', architecture: 'amd64', repoDigests: [] });
    }),
  };
  return { engine, images };
}

describe('App image acquisition order', () => {
  it('reuses a compatible local image without contacting the registry', async () => {
    const { engine, images } = createEngine();
    images.set(manifest.image, { id: digest, os: 'linux', architecture: 'amd64', repoDigests: [] });

    const result = await new AppImageAcquirer(engine).acquire(manifest);

    expect(result.source).toBe('local');
    expect(result.digest).toBe(digest);
    expect(engine.pullImage).not.toHaveBeenCalled();
    expect(engine.buildImage).not.toHaveBeenCalled();
  });

  it('pulls the published image for the daemon architecture and records its registry digest', async () => {
    const { engine } = createEngine();
    const stages: string[] = [];

    const result = await new AppImageAcquirer(engine).acquire(manifest, ({ stage }) =>
      stages.push(stage),
    );

    expect(result.source).toBe('registry');
    expect(result.digest).toBe('ghcr.io/haus/fixture@' + digest);
    expect(engine.pullImage).toHaveBeenCalledWith(
      manifest.image,
      'linux/amd64',
      expect.any(Function),
      undefined,
    );
    expect(stages).toEqual(['checking-local', 'pulling', 'pulling', 'ready']);
  });

  it('builds only from the pinned recipe after the published image cannot be pulled', async () => {
    const { engine } = createEngine();
    vi.mocked(engine.pullImage).mockRejectedValueOnce(Error('docker_registry_auth_failed'));

    const result = await new AppImageAcquirer(engine).acquire(manifest);

    expect(result.source).toBe('build');
    expect(engine.buildImage).toHaveBeenCalledWith(
      manifest.build,
      'haus-local/fixture-app:bbbbbbbbbbbb',
      expect.any(Function),
      undefined,
    );
  });

  it('does not invent a build when no recipe is declared', async () => {
    const { engine } = createEngine();
    vi.mocked(engine.pullImage).mockRejectedValueOnce(Error('docker_registry_auth_failed'));

    await expect(
      new AppImageAcquirer(engine).acquire({ ...manifest, build: undefined }),
    ).rejects.toThrow('docker_registry_auth_failed');
    expect(engine.buildImage).not.toHaveBeenCalled();
  });

  it('rejects an architecture mismatch before pulling or building', async () => {
    const { engine } = createEngine();
    vi.mocked(engine.getHostPlatform).mockResolvedValueOnce({
      os: 'linux',
      architecture: 'aarch64',
    });

    await expect(
      new AppImageAcquirer(engine).acquire({ ...manifest, architectures: ['amd64'] }),
    ).rejects.toThrow('app_unsupported_architecture');
    expect(engine.pullImage).not.toHaveBeenCalled();
  });

  it('keeps an aborted registry pull from falling through to a source build', async () => {
    const { engine } = createEngine();
    const controller = new AbortController();
    vi.mocked(engine.pullImage).mockImplementationOnce(async () => {
      controller.abort();
      throw Error('registry_connection_reset');
    });

    await expect(
      new AppImageAcquirer(engine).acquire(manifest, undefined, controller.signal),
    ).rejects.toMatchObject({ code: 'app_operation_cancelled' });
    expect(engine.buildImage).not.toHaveBeenCalled();
  });

  it('reports cancellation instead of masking a failed build', async () => {
    const { engine } = createEngine();
    const controller = new AbortController();
    vi.mocked(engine.pullImage).mockRejectedValueOnce(Error('registry_auth_failed'));
    vi.mocked(engine.buildImage).mockImplementationOnce(async () => {
      controller.abort();
      throw Error('build_connection_reset');
    });

    await expect(
      new AppImageAcquirer(engine).acquire(manifest, undefined, controller.signal),
    ).rejects.toMatchObject({ code: 'app_operation_cancelled' });
  });
});
