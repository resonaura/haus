/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HassEntity } from '../types.js';
export type {
  HassEntity,
  Area,
  Device,
  EntityRegistryEntry,
  Snapshot,
  HausAction,
} from '../types.js';

export type Category =
  | 'lights'
  | 'climate'
  | 'security'
  | 'media'
  | 'water'
  | 'outlets'
  | 'covers'
  | 'printers'
  | 'network'
  | 'sensors'
  | 'appliances'
  | 'robotics'
  | 'other';

export interface HausAccessory {
  id: string;
  deviceId?: string;
  primaryEntityId: string;
  entityIds: string[];
  areaId?: string;
  manufacturer?: string | null;
  model?: string | null;
  category: Category;
  name: string;
  batteryLevel?: number;
  batteryCharging?: boolean;
  powerStrip?: boolean;
  buttonController?: boolean;
  physicalHub?: boolean;
  visibilityEntityIds?: string[];
  availability: 'available' | 'unavailable' | 'unknown';
  capabilities: string[];
  state: HassEntity;
  secondaryEntities: HassEntity[];
  defaultHidden?: boolean;
  isService?: boolean;
  pending?: boolean;
  pendingSince?: number;
  /** Local presentation group. Its members remain independent Home Assistant devices. */
  lightGroup?: { key: string; members: HausAccessory[] };
}

export interface HausRoom {
  id: string;
  name: string;
  accessories: HausAccessory[];
}

export interface HausModel {
  accessories: HausAccessory[];
  rooms: HausRoom[];
  scenes: HassEntity[];
  scenePlacements: Array<{
    sceneId: string;
    areaId?: string;
    scope: 'room' | 'home';
    confidence: number;
    targetCount: number;
    matchScore?: number;
    matchCoverage?: number;
    active?: boolean;
  }>;
  cameras: HassEntity[];
  attention: Array<{
    id: string;
    title: string;
    description: string;
    entityId: string;
    severity: 'warning' | 'critical';
  }>;
}
