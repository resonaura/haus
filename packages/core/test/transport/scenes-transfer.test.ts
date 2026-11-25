/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  buildDemoSceneTransferBundleJson,
  buildInitialSceneImportEntries,
  formatSceneTargetSetting,
  importSceneTransferBundle,
  MAX_SCENE_TRANSFER_BYTES,
  parseRgbColorString,
  parseSceneTransferBundleText,
  simulateDemoSceneTransferImport,
  type ManagementPort,
  type ManagementRequest,
} from '../../src/transport/index.js';

function validScenesJson(overrides: readonly Record<string, unknown>[] = []): string {
  const defaultScenes = [
    {
      id: 'brand_new_scene',
      name: 'Brand New Scene',
      haEntityId: 'scene.brand_new_scene',
      areaName: 'Living Room',
      icon: 'mdi:sofa',
      entities: {
        'light.living_room_pendant': { state: 'on', brightness: 200 },
        'switch.reading_nook': 'on',
      },
    },
  ];
  return JSON.stringify({
    scenes: overrides.length ? overrides : defaultScenes,
  });
}

describe('scenes transfer core', () => {
  it('validates scene bundles and enforces size, count, domain, safety, and duplicate checks', () => {
    const parsed = parseSceneTransferBundleText(validScenesJson());
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe('brand_new_scene');

    const demoScenes = parseSceneTransferBundleText(buildDemoSceneTransferBundleJson());
    expect(demoScenes).toHaveLength(2);
    const initial = buildInitialSceneImportEntries(demoScenes, new Set(['movie_time']));
    expect(initial.map((entry) => [entry.id, entry.exists])).toEqual([
      ['evening_reading', false],
      ['movie_time', true],
    ]);

    const demoResult = simulateDemoSceneTransferImport(
      demoScenes,
      [
        { id: 'living_room', name: 'Living Room' },
        { id: 'hallway', name: 'Hallway' },
      ],
      new Set(['movie_time']),
    );
    expect(demoResult.stagedCount).toBe(1);
    expect(demoResult.completed).toBe(2);

    expect(() => parseSceneTransferBundleText('{}', MAX_SCENE_TRANSFER_BYTES + 1)).toThrow(
      'The scene transfer file exceeds 256 KB.',
    );

    expect(() => parseSceneTransferBundleText('{"__proto__":{}, "scenes":[]}')).toThrow(
      'Choose a valid Home Assistant scenes transfer file.',
    );

    const seventeen = Array.from({ length: 17 }, (_, i) => ({
      id: `scene_${i}`,
      name: `Scene ${i}`,
      haEntityId: `scene.scene_${i}`,
      entities: { 'light.lamp': 'on' },
    }));
    expect(() => parseSceneTransferBundleText(JSON.stringify({ scenes: seventeen }))).toThrow(
      'Choose a valid Home Assistant scenes transfer file.',
    );

    expect(() =>
      parseSceneTransferBundleText(
        validScenesJson([
          {
            id: 'bad_domain',
            name: 'Bad Domain',
            haEntityId: 'scene.bad_domain',
            entities: { 'lock.front_door': 'lock' },
          },
        ]),
      ),
    ).toThrow('The scene transfer file contains an unsupported target.');

    expect(() =>
      parseSceneTransferBundleText(
        validScenesJson([
          {
            id: 'dup_scene',
            name: 'One',
            haEntityId: 'scene.one',
            entities: { 'light.a': 'on' },
          },
          {
            id: 'dup_scene',
            name: 'Two',
            haEntityId: 'scene.two',
            entities: { 'light.b': 'on' },
          },
        ]),
      ),
    ).toThrow('The scene transfer file is empty or contains duplicate IDs.');
  });

  it('validates rooms before POSTing, skips existing scenes, restores missing rooms, and preserves stagedIds', async () => {
    const rooms = [{ id: 'living_room', name: 'Living Room' }];
    const scenes = parseSceneTransferBundleText(
      validScenesJson([
        {
          id: 'new_scene',
          name: 'New Scene',
          haEntityId: 'scene.new_scene',
          areaName: 'Living Room',
          icon: 'mdi:lightbulb',
          entities: { 'light.living_room_pendant': { state: 'on', brightness: 180 } },
        },
        {
          id: 'edited_scene',
          name: 'Edited Scene',
          haEntityId: 'scene.edited_scene',
          areaName: 'Living Room',
          entities: { 'light.corner_lamp': 'on' },
        },
        {
          id: 'restore_scene',
          name: 'Restore Scene',
          haEntityId: 'scene.restore_scene',
          areaName: 'Living Room',
          entities: { 'switch.reading_nook': 'on' },
        },
      ]),
    );

    const requests: ManagementRequest[] = [];
    const port: ManagementPort = {
      async management<T = unknown>(input: ManagementRequest): Promise<T> {
        requests.push(input);
        if (input.method === 'GET' && input.path === 'haus/rules/scenes') {
          return {
            scenes: [
              { id: 'edited_scene', name: 'Renamed by user', roomId: 'living_room' },
              {
                id: 'restore_scene',
                name: 'Restore Scene',
                metadata: {
                  haEntityId: 'scene.restore_scene',
                  haEntities: { 'switch.reading_nook': 'on' },
                },
              },
            ],
          } as T;
        }
        return { ok: true } as T;
      },
    };

    const missingRoomScenes = parseSceneTransferBundleText(
      validScenesJson([
        {
          id: 'attic_scene',
          name: 'Attic Scene',
          haEntityId: 'scene.attic_scene',
          areaName: 'Attic',
          entities: { 'light.attic': 'on' },
        },
      ]),
    );
    await expect(importSceneTransferBundle(port, missingRoomScenes, rooms)).rejects.toThrow(
      'Haus has no room matching “Attic”. No scenes were changed.',
    );
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);

    const stagedIds = new Set<string>();
    const result = await importSceneTransferBundle(port, scenes, rooms, undefined, stagedIds);
    expect(result.stagedCount).toBe(2);
    expect(result.completed).toBe(3);
    expect(result.entries.find((e) => e.id === 'restore_scene')?.restoreRoom).toBe(true);
    expect(result.entries.find((e) => e.id === 'edited_scene')?.exists).toBe(true);

    const posts = requests.filter((r) => r.method === 'POST');
    expect(posts.map((p) => p.path)).toEqual([
      'config/scene/config/new_scene',
      'config/scene/config/restore_scene',
    ]);
    expect(posts[0]?.data).toMatchObject({
      name: 'New Scene',
      room_id: 'living_room',
      haEntityId: 'scene.new_scene',
    });

    // Retry with the same stagedIds must skip already-staged IDs
    const requestsBeforeRetry = requests.length;
    await importSceneTransferBundle(port, scenes, rooms, undefined, stagedIds);
    const retryPosts = requests.slice(requestsBeforeRetry).filter((r) => r.method === 'POST');
    expect(retryPosts).toHaveLength(0);
  });

  it('formats scene targets and parses RGB colors cleanly', () => {
    expect(formatSceneTargetSetting('on')).toEqual({ targetSummary: 'on' });
    expect(
      formatSceneTargetSetting({ attributes: { brightness: 128 }, state: 'on' }),
    ).toMatchObject({ targetSummary: 'on · 50% brightness' });
    expect(formatSceneTargetSetting(undefined).targetSummary).toBe('Target setting not supplied');

    expect(parseRgbColorString('rgb(255, 200, 140)')).toEqual([255, 200, 140]);
    expect(parseRgbColorString(undefined)).toBeUndefined();
  });
});
