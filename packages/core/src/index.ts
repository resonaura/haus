/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export { OptimisticState, EntityActionQueue } from './optimistic.js';
export type {
  AddClusterNodeInput,
  ClusterNode,
  ClusterNodePatch,
  ClusterStatus,
} from './helper-client.js';
export {
  helperFeatureNames,
  parseHelperCapabilities,
  parseHelperLiveMessage,
  safeHelperDiagnostic,
  supportsHelperFeature,
} from './helper-protocol.js';
export type {
  HelperCapabilities,
  HelperDiagnostic,
  HelperDiagnosticOperation,
  HelperFeature,
  HelperFeatures,
  HelperLiveMessage,
} from './helper-protocol.js';
export {
  LightOutputMemory,
  sanitizeLightMemory,
  sanitizeHomeLightMemories,
} from './light-memory.js';
export { lightColor } from './light-color.js';
export {
  createSnapshotEnvelope,
  parseSnapshotEnvelope,
  snapshotEnvelopeSchema,
  snapshotEnvelopeVersion,
} from './snapshot-envelope.js';
export type { ParseSnapshotEnvelopeOptions, SnapshotEnvelope } from './snapshot-envelope.js';
export { lightProfile, lightTemperature, lightStateDescription } from './light-profile.js';
export type { HassEntity, HausAction, Snapshot } from './types.js';
