/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { isIP } from 'node:net';
import { validateInventory } from '@haus/bridge/protocol';
import type { CameraMigrationEvidence } from './types.js';

const privateHost = (value: string) =>
  isIP(value) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);

/** Every component except the already-authorized bridge host must match exactly. */
export function cameraMigrationProof(input: CameraMigrationEvidence) {
  const inventory = validateInventory(input.inventory);
  if (
    !input.homeId.trim() ||
    !privateHost(input.move.fromHost) ||
    !privateHost(input.move.toHost) ||
    input.move.fromHost === input.move.toHost ||
    !inventory.cameras.length
  )
    throw Error('camera_migration_invalid_evidence');
  const resolved = inventory.cameras.map((camera) => {
    const current = new URL(camera.stream.url);
    if (camera.stream.transport !== 'p2p' || current.hostname !== input.move.toHost)
      throw Error('camera_migration_source_mismatch');
    const matches = input.assignments.filter((assignment) => {
      if (assignment.source.kind !== 'p2p-restream') return false;
      const previous = new URL(assignment.source.url);
      if (previous.hostname !== input.move.fromHost) return false;
      previous.hostname = input.move.toHost;
      return previous.href === current.href;
    });
    const match = matches[0];
    if (matches.length !== 1 || !match || !/^camera\.[a-z0-9_]{1,128}$/.test(match.cameraId))
      throw Error('camera_migration_archive_ambiguous');
    const aliases = [camera.mqtt, ...camera.entities.map((entity) => entity.mqtt)];
    if (aliases.some((alias) => !alias)) throw Error('camera_migration_alias_missing');
    return { camera, cameraId: match.cameraId };
  });
  if (new Set(resolved.map((row) => row.cameraId)).size !== resolved.length)
    throw Error('camera_migration_archive_ambiguous');
  return { inventory, resolved };
}
