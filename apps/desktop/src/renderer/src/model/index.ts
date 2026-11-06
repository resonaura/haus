/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type {
  Area,
  Category,
  Device,
  EntityRegistryEntry,
  HassEntity,
  HausAccessory,
  HausAction,
  HausModel,
  HausRoom,
  Snapshot,
} from './types';
export { entityDomain, resolveCapabilities } from './capabilities';
export {
  effectiveArea,
  entityCategory,
  isSegmentEntity,
  isStatefulScene,
  normalizeHome,
} from './normalize';
export { applyDemoAction, buildAction } from './actions';
export { createDemoSnapshot } from './demo';
export { generateDashboard } from './dashboard';
