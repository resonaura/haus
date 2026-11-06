/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  activeYuzuOSCapabilities,
  loadYuzuOSTrafficLights,
  type YuzuOSCapabilities,
} from './yuzuos-appearance';

const revision = '1234567890abcdef12345678';
const caps = (): YuzuOSCapabilities => ({
  version: 1,
  uuid: 'yuzuos@resonaura.local',
  revision,
  applicationBlur: { enabled: true },
  trafficLights: { enabled: true, style: 'glass', artworkDirectory: null },
});
const status = () => ({
  uuid: 'yuzuos@resonaura.local',
  revision,
  enabled: true,
  phase: 'active',
  error: null,
});
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('live YuzuOS capabilities', () => {
  it('accepts matching active runtime capabilities, not only a configured UUID', () => {
    const value = { status: status(), capabilities: caps() };
    expect(activeYuzuOSCapabilities(value)?.applicationBlur.enabled).toBe(true);
    for (const override of [
      { enabled: false },
      { phase: 'loading' },
      { phase: 'rollback' },
      { error: 'failed' },
      { revision: 'abcdefabcdefabcdefabcdef' },
    ]) {
      expect(
        activeYuzuOSCapabilities({ ...value, status: { ...status(), ...override } }),
      ).toBeNull();
    }
    expect(
      activeYuzuOSCapabilities({ status: status(), capabilities: { ...caps(), version: 2 } }),
    ).toBeNull();
    expect(activeYuzuOSCapabilities({ status: status() })).toBeNull();
  });
  it('preserves explicit app-blur and traffic-light off states', () => {
    const capability = caps();
    capability.applicationBlur.enabled = false;
    capability.trafficLights.enabled = false;
    expect(
      activeYuzuOSCapabilities({ status: status(), capabilities: capability })?.applicationBlur
        .enabled,
    ).toBe(false);
    expect(
      activeYuzuOSCapabilities({ status: status(), capabilities: capability })?.trafficLights
        .enabled,
    ).toBe(false);
  });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'haus-yuzuos-artwork-'));
  temporary.push(root);
  const directory = join(root, 'runtime', revision, 'icons/titlebuttons-native');
  await mkdir(directory, { recursive: true });
  const assets: Record<string, unknown> = {};
  for (const scale of [1, 2]) {
    // Unmodified AppKit fixture pixels; metadata/path/hash validation is under test.
    const bytes = await readFile(new URL(`./fixtures/yuzuos/close@${scale}x.png`, import.meta.url));
    const file = `fixture@${scale}x.png`;
    await writeFile(join(directory, file), bytes);
    for (const appearance of ['light', 'dark'])
      for (const role of ['close', 'minimize', 'zoom'])
        for (const state of ['active', 'inactive', 'hover', 'pressed', 'disabled'])
          assets[`${appearance}-${role}-${state}@${scale}x`] = {
            file,
            scale,
            appearance,
            role,
            state,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          };
  }
  const captureSHA256 = 'a'.repeat(64);
  const manifest = {
    version: 1,
    captureSHA256,
    geometry: {
      close: { x: 9, y: 9, width: 14, height: 14 },
      minimize: { x: 32, y: 9, width: 14, height: 14 },
      zoom: { x: 55, y: 9, width: 14, height: 14 },
    },
    assets,
  };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(
    join(directory, 'PROVENANCE.json'),
    JSON.stringify({ localNativeAssets: true, manifestSHA256: captureSHA256 }),
  );
  const capability = caps();
  capability.trafficLights.artworkDirectory = directory;
  return { root, directory, capability, manifest };
}

describe('native YuzuOS artwork handoff', () => {
  it('loads verified 1x/2x data URLs, original geometry and all five states', async () => {
    const f = await fixture();
    const artwork = await loadYuzuOSTrafficLights(f.capability, [f.root]);
    expect(artwork).toMatchObject({ width: 14, height: 14, gap: 9 });
    expect(Object.keys(artwork!.images.dark.close)).toHaveLength(5);
    expect(artwork!.images.dark.close.active).toMatch(/^image-set\(url\("data:image\/png;base64,/);
    expect(artwork!.images.dark.close.active).toContain(' 2x');
    f.capability.trafficLights.enabled = false;
    expect(await loadYuzuOSTrafficLights(f.capability, [f.root])).toBeUndefined();
  });
  it('rejects untrusted paths, modified PNG bytes and mismatched provenance', async () => {
    const f = await fixture();
    await expect(
      loadYuzuOSTrafficLights(f.capability, [join(f.root, 'not-installed')]),
    ).rejects.toThrow('outside');
    await writeFile(join(f.directory, 'fixture@2x.png'), Buffer.alloc(30));
    await expect(loadYuzuOSTrafficLights(f.capability, [f.root])).rejects.toThrow('differs');
    await writeFile(
      join(f.directory, 'PROVENANCE.json'),
      JSON.stringify({ localNativeAssets: true, manifestSHA256: 'b'.repeat(64) }),
    );
    await expect(loadYuzuOSTrafficLights(f.capability, [f.root])).rejects.toThrow('provenance');
  });
  it('scales display geometry while validating the original PNG dimensions', async () => {
    const f = await fixture();
    f.capability.trafficLights.renderScale = 1.2;
    const artwork = await loadYuzuOSTrafficLights(f.capability, [f.root]);
    expect(artwork!.width).toBeCloseTo(16.8);
    expect(artwork!.height).toBeCloseTo(16.8);
    expect(artwork!.gap).toBeCloseTo(10.8);
    f.capability.trafficLights.renderScale = 7;
    await expect(loadYuzuOSTrafficLights(f.capability, [f.root])).rejects.toThrow('display scale');
  });
});
