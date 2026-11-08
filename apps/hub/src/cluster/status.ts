/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { isRecord } from '@haus/core/record';
import type { ClusterNodeRemoteStatus } from './health.js';

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function numbers(value: unknown, required: string[], optional: string[] = []): boolean {
  if (!isRecord(value)) return false;
  const valid = (item: unknown) => typeof item === 'number' && Number.isFinite(item) && item >= 0;
  return (
    required.every((key) => valid(value[key])) &&
    optional.every((key) => value[key] === undefined || valid(value[key]))
  );
}

function optionalBoolean(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => value[key] === undefined || typeof value[key] === 'boolean');
}

function validStatus(value: unknown): value is ClusterNodeRemoteStatus {
  if (
    !isRecord(value) ||
    value.protocol !== 1 ||
    typeof value.nodeId !== 'string' ||
    !value.nodeId ||
    !numbers(value.storage, ['usedBytes', 'maxBytes'], ['reservedBytes', 'availableBytes']) ||
    !numbers(value.streams, ['active', 'max'])
  )
    return false;
  if (
    ['instanceId', 'relayOrigin'].some(
      (key) => value[key] !== undefined && typeof value[key] !== 'string',
    ) ||
    (value.roles !== undefined && !strings(value.roles))
  )
    return false;
  const storage = value.storage;
  if (!isRecord(storage)) return false;
  if (
    storage.storageLimitBytes !== undefined &&
    storage.storageLimitBytes !== null &&
    !(
      typeof storage.storageLimitBytes === 'number' &&
      Number.isFinite(storage.storageLimitBytes) &&
      storage.storageLimitBytes >= 0
    )
  )
    return false;
  if (
    storage.verification !== undefined &&
    (!isRecord(storage.verification) || !optionalBoolean(storage.verification, ['supported']))
  )
    return false;
  if (storage.usage !== undefined && !numbers(storage.usage, ['version'])) return false;
  if (
    value.settings !== undefined &&
    (!isRecord(value.settings) ||
      (value.settings.storageLimitBytes !== undefined &&
        value.settings.storageLimitBytes !== null &&
        !numbers(value.settings, ['storageLimitBytes'])))
  )
    return false;
  if (value.playback !== undefined && !numbers(value.playback, ['profile', 'active', 'max']))
    return false;
  if (
    value.resources !== undefined &&
    (!numbers(value.resources, ['cpu', 'cpus', 'memoryBytes']) ||
      !isRecord(value.resources) ||
      !optionalBoolean(value.resources, ['pressured']))
  )
    return false;
  if (
    value.rtspSessions !== undefined &&
    (!numbers(value.rtspSessions, ['max'], ['profile', 'active']) ||
      !isRecord(value.rtspSessions) ||
      !optionalBoolean(value.rtspSessions, ['webrtc', 'recording']))
  )
    return false;
  if (
    value.features !== undefined &&
    (!numbers(
      value.features,
      [],
      [
        'cameraContinuity',
        'cameraRecordingRecovery',
        'cameraAccessPolicy',
        'autonomousCameraActivity',
      ],
    ) ||
      !isRecord(value.features) ||
      !optionalBoolean(value.features, ['rtspPeer', 'directCameraAccess']))
  )
    return false;
  return true;
}

export function enrollmentStatus(value: unknown): ClusterNodeRemoteStatus {
  if (!validStatus(value)) throw Error('invalid_node_protocol');
  return value;
}
