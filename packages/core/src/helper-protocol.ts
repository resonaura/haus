/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isRecord } from './record.js';

export const helperFeatureNames = [
  'cluster',
  'customTalkback',
  'eufyTalkback',
  'nvrCameraSessions',
  'previewPreheat',
  'recordingRepair',
  'sharedPreferences',
  'softwareMotion',
  'unifiedActivity',
  'verifiedOriginalPlayback',
] as const;

export type HelperFeature = (typeof helperFeatureNames)[number];
export type HelperFeatures = Partial<Record<HelperFeature, boolean>>;

export interface HelperCapabilities {
  protocol: 1 | null;
  name: string;
  version: string;
  connected: boolean;
  features: HelperFeatures;
}

export interface HelperLiveMessage {
  protocol: 1;
  instance: string;
  sequence: number;
  topic: 'home' | 'preferences' | 'cameras' | 'heartbeat';
  revision: string;
  connected: boolean;
  sources?: { id: string; available: boolean; expiresAt: number }[];
}

const instanceId = /^[a-f0-9-]{36}$/;
const revisionId = /^(0|[a-f0-9-]{36})$/;
const cameraId = /^camera\.[a-z0-9_]+$/;

/** Parse only the public, non-secret capabilities needed to negotiate Helper features. */
export function parseHelperCapabilities(value: unknown): HelperCapabilities | undefined {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    value.name.length > 64 ||
    typeof value.version !== 'string' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/.test(value.version) ||
    typeof value.connected !== 'boolean' ||
    (value.protocol !== undefined && value.protocol !== 1) ||
    !isRecord(value.features)
  )
    return undefined;

  const features: HelperFeatures = {};
  for (const feature of helperFeatureNames) {
    const supported = value.features[feature];
    if (typeof supported === 'boolean') features[feature] = supported;
  }
  return {
    protocol: value.protocol === 1 ? 1 : null,
    name: value.name,
    version: value.version,
    connected: value.connected,
    features,
  };
}

export function supportsHelperFeature(capabilities: HelperCapabilities, feature: HelperFeature) {
  return capabilities.features[feature] === true;
}

/** Validate a live frame and discard every field outside the versioned, redacted contract. */
export function parseHelperLiveMessage(
  value: unknown,
  now = Date.now(),
): HelperLiveMessage | undefined {
  if (
    !isRecord(value) ||
    value.protocol !== 1 ||
    typeof value.instance !== 'string' ||
    !instanceId.test(value.instance) ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    !['home', 'preferences', 'cameras', 'heartbeat'].includes(String(value.topic)) ||
    typeof value.connected !== 'boolean' ||
    typeof value.revision !== 'string' ||
    !revisionId.test(value.revision)
  )
    return undefined;

  const sources = value.sources;
  const safeSources =
    Array.isArray(sources) &&
    sources.length <= 256 &&
    sources.every(
      (source) =>
        isRecord(source) &&
        typeof source.id === 'string' &&
        cameraId.test(source.id) &&
        typeof source.available === 'boolean' &&
        typeof source.expiresAt === 'number' &&
        Number.isSafeInteger(source.expiresAt) &&
        Number(source.expiresAt) >= 0 &&
        Number(source.expiresAt) <= now + 120000,
    )
      ? sources.map((source) => ({
          id: String((source as { id: string }).id),
          available: Boolean((source as { available: boolean }).available),
          expiresAt: Number((source as { expiresAt: number }).expiresAt),
        }))
      : undefined;

  return {
    protocol: 1,
    instance: value.instance,
    sequence: Number(value.sequence),
    topic: value.topic as HelperLiveMessage['topic'],
    revision: value.revision,
    connected: value.connected,
    ...(safeSources ? { sources: safeSources } : {}),
  };
}

export type HelperDiagnosticOperation =
  | 'helper-status'
  | 'list-servers'
  | 'list-cluster'
  | 'update-storage-limit'
  | 'enroll-node'
  | 'update-node'
  | 'remove-node'
  | 'other-allowlisted';

export interface HelperDiagnostic {
  operation: HelperDiagnosticOperation;
  outcome: 'success' | 'failure';
  durationMs: number;
}

/** Public diagnostic shape deliberately excludes request paths, IDs, response bodies and errors. */
export function safeHelperDiagnostic(value: unknown): HelperDiagnostic | undefined {
  if (
    !isRecord(value) ||
    ![
      'helper-status',
      'list-servers',
      'list-cluster',
      'update-storage-limit',
      'enroll-node',
      'update-node',
      'remove-node',
      'other-allowlisted',
    ].includes(String(value.operation)) ||
    !['success', 'failure'].includes(String(value.outcome)) ||
    typeof value.durationMs !== 'number' ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0
  )
    return undefined;
  return {
    operation: value.operation as HelperDiagnosticOperation,
    outcome: value.outcome as HelperDiagnostic['outcome'],
    durationMs: Math.min(300000, Math.round(value.durationMs)),
  };
}
