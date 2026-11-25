/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { asRecord } from '../automations/types.js';
import type { ManagementPort } from '../config-editor.js';
import {
  MAX_SCENE_TRANSFER_BYTES,
  type HaSceneImport,
  type SceneImportProgress,
  type SceneImportResult,
  type SceneImportSummary,
  type SceneRoomRef,
} from './types.js';

function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 24) return false;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every((item) => safeJson(item, depth + 1));
  const object = asRecord(value);
  return Boolean(
    object &&
    Object.entries(object).every(
      ([key, item]) =>
        key !== '__proto__' &&
        key !== 'prototype' &&
        key !== 'constructor' &&
        safeJson(item, depth + 1),
    ),
  );
}

function parseScene(value: unknown): HaSceneImport {
  const scene = asRecord(value);
  const entities = scene ? asRecord(scene.entities) : undefined;
  if (
    !scene ||
    typeof scene.id !== 'string' ||
    !/^[a-z0-9_-]{1,128}$/.test(scene.id) ||
    typeof scene.name !== 'string' ||
    !scene.name.trim() ||
    scene.name.length > 256 ||
    typeof scene.haEntityId !== 'string' ||
    !/^scene\.[a-z0-9_]+$/.test(scene.haEntityId) ||
    !entities ||
    Object.keys(entities).length > 100
  ) {
    throw new Error('The scene transfer file contains an invalid entry.');
  }
  if (
    Object.entries(entities).some(
      ([id, target]) =>
        !/^(light|switch)\.[a-z0-9_]+$/.test(id) ||
        !(typeof target === 'string' || asRecord(target)) ||
        !safeJson(target),
    )
  ) {
    throw new Error('The scene transfer file contains an unsupported target.');
  }
  if (scene.icon !== undefined && (typeof scene.icon !== 'string' || scene.icon.length > 128)) {
    throw new Error('The scene transfer file contains invalid display metadata.');
  }
  if (
    scene.areaName !== undefined &&
    (typeof scene.areaName !== 'string' || !scene.areaName.trim() || scene.areaName.length > 128)
  ) {
    throw new Error('The scene transfer file contains invalid room metadata.');
  }
  return {
    id: scene.id,
    name: scene.name.trim(),
    haEntityId: scene.haEntityId,
    ...(typeof scene.icon === 'string' ? { icon: scene.icon } : {}),
    ...(typeof scene.areaName === 'string' ? { areaName: scene.areaName.trim() } : {}),
    entities,
  };
}

export function parseSceneTransferBundleText(
  rawText: string,
  byteLength?: number,
): HaSceneImport[] {
  const bytes = byteLength ?? new TextEncoder().encode(rawText).byteLength;
  if (bytes > MAX_SCENE_TRANSFER_BYTES) {
    throw new Error('The scene transfer file exceeds 256 KB.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Choose a valid Home Assistant scenes transfer file.');
  }
  const bundle = asRecord(parsed);
  if (!safeJson(parsed) || !bundle || !Array.isArray(bundle.scenes) || bundle.scenes.length > 16) {
    throw new Error('Choose a valid Home Assistant scenes transfer file.');
  }
  const scenes = bundle.scenes.map(parseScene);
  if (scenes.length === 0 || new Set(scenes.map((scene) => scene.id)).size !== scenes.length) {
    throw new Error('The scene transfer file is empty or contains duplicate IDs.');
  }
  return scenes;
}

export function buildInitialSceneImportEntries(
  scenes: readonly HaSceneImport[],
  existingIds: ReadonlySet<string>,
): SceneImportSummary[] {
  return scenes.map((scene) => ({
    id: scene.id,
    name: scene.name,
    entities: Object.keys(scene.entities).length,
    exists: existingIds.has(scene.id),
    ...(scene.areaName ? { areaName: scene.areaName } : {}),
  }));
}

export function buildDemoSceneTransferBundleJson(): string {
  return JSON.stringify(
    {
      scenes: [
        {
          id: 'evening_reading',
          name: 'Evening reading',
          haEntityId: 'scene.evening_reading',
          areaName: 'Living Room',
          icon: 'mdi:book-open-variant',
          entities: {
            'light.living_room_pendant': { state: 'on', brightness: 170 },
            'switch.reading_nook': 'on',
          },
        },
        {
          id: 'movie_time',
          name: 'Movie time',
          haEntityId: 'scene.movie_time',
          areaName: 'Hallway',
          icon: 'mdi:movie-open-outline',
          entities: {
            'light.corner_lamp': { state: 'on', brightness: 120 },
          },
        },
      ],
    },
    null,
    2,
  );
}

export async function readExistingTransferScenes(
  port: ManagementPort,
): Promise<Map<string, Record<string, unknown>>> {
  const response = await port.management({
    method: 'GET',
    path: 'haus/rules/scenes',
  });
  const body = asRecord(response);
  if (!body || !Array.isArray(body.scenes)) {
    throw new Error('Haus could not verify the current scenes before import.');
  }
  return new Map(
    body.scenes.flatMap((value) => {
      const scene = asRecord(value);
      return typeof scene?.id === 'string' ? [[scene.id, scene] as const] : [];
    }),
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
    );
  }
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (!leftRecord || !rightRecord) return false;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    sameJson(leftKeys, rightKeys) &&
    leftKeys.every((key) => sameJson(leftRecord[key], rightRecord[key]))
  );
}

function sceneMatchesImport(existing: Record<string, unknown>, scene: HaSceneImport): boolean {
  const metadata = asRecord(existing.metadata);
  return (
    existing.name === scene.name &&
    (metadata?.haEntityId === undefined || metadata.haEntityId === scene.haEntityId) &&
    sameJson(metadata?.haEntities, scene.entities)
  );
}

export function roomIdForName(
  areaName: string | undefined,
  rooms: readonly SceneRoomRef[],
): string | undefined {
  if (!areaName) return undefined;
  const normalized = areaName.trim().toLocaleLowerCase();
  return rooms.find((room) => room.name.trim().toLocaleLowerCase() === normalized)?.id;
}

export async function importSceneTransferBundle(
  port: ManagementPort,
  scenes: readonly HaSceneImport[],
  rooms: readonly SceneRoomRef[],
  onProgress?: (progress: SceneImportProgress) => void,
  stagedIds: Set<string> = new Set<string>(),
): Promise<SceneImportResult> {
  const currentScenes = await readExistingTransferScenes(port);
  const roomIds = new Map<string, string>();
  for (const scene of scenes) {
    const roomId = roomIdForName(scene.areaName, rooms);
    if (scene.areaName && !roomId) {
      throw new Error(`Haus has no room matching “${scene.areaName}”. No scenes were changed.`);
    }
    if (roomId) roomIds.set(scene.id, roomId);
  }

  const restoreRoomIds = new Set<string>();
  const updatedEntries: SceneImportSummary[] = scenes.map((scene) => {
    const existing = currentScenes.get(scene.id);
    const restoreRoom = Boolean(
      existing && !existing.roomId && roomIds.has(scene.id) && sceneMatchesImport(existing, scene),
    );
    if (restoreRoom) restoreRoomIds.add(scene.id);
    return {
      id: scene.id,
      name: scene.name,
      entities: Object.keys(scene.entities).length,
      exists: Boolean(existing),
      ...(scene.areaName ? { areaName: scene.areaName } : {}),
      ...(restoreRoom ? { restoreRoom: true } : {}),
    };
  });
  onProgress?.({ entries: updatedEntries, completed: 0 });

  let stagedCount = 0;
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (!scene) throw new Error('The selected transfer data is no longer available.');
    const existing = currentScenes.get(scene.id);
    const restoreRoom = restoreRoomIds.has(scene.id);
    if (existing && !restoreRoom) {
      onProgress?.({ entries: updatedEntries, completed: index + 1 });
      continue;
    }
    if (stagedIds.has(scene.id)) {
      onProgress?.({ entries: updatedEntries, completed: index + 1 });
      continue;
    }
    await port.management({
      method: 'POST',
      path: `config/scene/config/${encodeURIComponent(scene.id)}`,
      data: {
        name: scene.name,
        ...(scene.icon ? { icon: scene.icon } : {}),
        haEntityId: scene.haEntityId,
        ...(roomIds.has(scene.id) ? { room_id: roomIds.get(scene.id) } : {}),
        entities: scene.entities,
      },
    });
    stagedIds.add(scene.id);
    stagedCount += 1;
    onProgress?.({ entries: updatedEntries, completed: index + 1 });
  }

  return { entries: updatedEntries, completed: scenes.length, stagedCount };
}

export function simulateDemoSceneTransferImport(
  scenes: readonly HaSceneImport[],
  rooms: readonly SceneRoomRef[],
  existingIds: ReadonlySet<string>,
  onProgress?: (progress: SceneImportProgress) => void,
): SceneImportResult {
  for (const scene of scenes) {
    const roomId = roomIdForName(scene.areaName, rooms);
    if (scene.areaName && !roomId) {
      throw new Error(`Haus has no room matching “${scene.areaName}”. No scenes were changed.`);
    }
  }
  const entries = buildInitialSceneImportEntries(scenes, existingIds);
  let stagedCount = 0;
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (scene && !existingIds.has(scene.id)) stagedCount += 1;
    onProgress?.({ entries, completed: index + 1 });
  }
  return { entries, completed: scenes.length, stagedCount };
}
