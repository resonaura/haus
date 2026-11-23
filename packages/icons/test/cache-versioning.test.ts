/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ICON_ENGINE_REVISION } from '../src/index.js';
import {
  IconRenderService,
  VersionedIconCache,
  computeEngineFingerprint,
  encodePngRgba,
  resolveEffectiveIconRevision,
  sha256Hex,
} from '../src/node/index.js';

function makeSolidPngDataUri(size: number, rgb: readonly [number, number, number]): string {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255;
  }
  return `data:image/png;base64,${encodePngRgba(rgba, size, size).toString('base64')}`;
}

describe('icon cache versioning and automatic engine fingerprinting', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes cache-format.json synchronously and uses version-independent content hashes for raw sources', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-icons-ver-'));
    tempDirs.push(root);

    const cacheV1 = new VersionedIconCache(root, { revision: 'rev-a' });
    const markerPath = join(cacheV1.namespaceDir, 'cache-format.json');
    expect(existsSync(markerPath)).toBe(true);
    expect(JSON.parse(readFileSync(markerPath, 'utf8'))).toMatchObject({ revision: 'rev-a' });

    const payload = Buffer.from('synthetic-icon-bytes');
    const written = await cacheV1.writeRawSource('integration:hue', payload, 'image/png', false);
    const expectedHash = sha256Hex(Buffer.concat([Buffer.from('image/png:'), payload]));
    expect(written.sourceHash).toBe(expectedHash);

    // Simulate a legacy sources/*.meta.json that previously baked `v3-gnome-v2:` into sourceHash.
    const keyHash = sha256Hex('integration:hue');
    const metaPath = join(cacheV1.sourcesDir, `${keyHash}.meta.json`);
    writeFileSync(
      metaPath,
      JSON.stringify({
        key: 'integration:hue',
        sourceHash: sha256Hex(Buffer.concat([Buffer.from('v3-gnome-v2:image/png:'), payload])),
        mime: 'image/png',
        isFallback: false,
        fetchedAt: Date.now(),
      }),
    );

    const cacheV2 = new VersionedIconCache(root, { revision: 'rev-b' });
    const readBack = await cacheV2.readRawSource('integration:hue');
    expect(readBack).not.toBeNull();
    expect(readBack!.meta.sourceHash).toBe(expectedHash);
  });

  it('derives deterministic engine fingerprints that change when the worker binary changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'haus-icons-fp-'));
    tempDirs.push(dir);
    const fakeBinA = join(dir, 'worker-a');
    const fakeBinB = join(dir, 'worker-b');
    writeFileSync(fakeBinA, 'binary-payload-v1');
    writeFileSync(fakeBinB, 'binary-payload-v2');

    const fpA1 = computeEngineFingerprint({ activeEngine: 'cpp', binaryPath: fakeBinA });
    const fpA2 = computeEngineFingerprint({ activeEngine: 'cpp', binaryPath: fakeBinA });
    const fpB = computeEngineFingerprint({ activeEngine: 'cpp', binaryPath: fakeBinB });
    const fpTs = computeEngineFingerprint({ activeEngine: 'ts', binaryPath: null });

    expect(fpA1).toMatch(/^cpp-[0-9a-f]{8}$/);
    expect(fpA1).toBe(fpA2);
    expect(fpB).toMatch(/^cpp-[0-9a-f]{8}$/);
    expect(fpB).not.toBe(fpA1);
    expect(fpTs).toMatch(/^ts-[0-9a-f]{8}$/);
    expect(resolveEffectiveIconRevision({ activeEngine: 'ts' })).toBe(
      `${ICON_ENGINE_REVISION}-${fpTs}`,
    );
  });

  it('automatically namespaces IconRenderService caches by engine fingerprint and reuses raw sources on rollover', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-icons-rollover-'));
    tempDirs.push(root);
    const dataUri = makeSolidPngDataUri(64, [24, 128, 240]);
    let fetches = 0;

    const svc1 = new IconRenderService({
      cacheRoot: root,
      allowCpp: false,
      tileSize: 64,
      concurrency: 2,
    });
    await svc1.init();
    expect(svc1.getStatus().version).toMatch(/^v3-gnome-v4-ts-[0-9a-f]{8}$/);

    const first = await svc1.resolveTile({
      source: {
        key: 'integration:sample',
        fetchSource: async () => {
          fetches += 1;
          return { dataUri, isFallback: false };
        },
      },
      appearance: 'default',
      variation: 'dark',
      tintHex: '#0a84ff',
    });
    expect(first.rendered).toBe(true);
    expect(first.cacheHit).toBe(false);
    expect(fetches).toBe(1);
    await svc1.dispose();

    // Restarting with identical engine hits the exact same namespace with zero re-render.
    const svc2 = new IconRenderService({
      cacheRoot: root,
      allowCpp: false,
      tileSize: 64,
      concurrency: 2,
    });
    await svc2.init();
    expect(svc2.getStatus().version).toBe(svc1.getStatus().version);
    const second = await svc2.resolveTile({
      source: {
        key: 'integration:sample',
        fetchSource: async () => {
          fetches += 1;
          return { dataUri, isFallback: false };
        },
      },
      appearance: 'default',
      variation: 'dark',
      tintHex: '#0a84ff',
    });
    expect(second.cacheHit).toBe(true);
    expect(fetches).toBe(1);
    await svc2.dispose();
  });
});
