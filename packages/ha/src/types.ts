/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Home Assistant wire types. These modules deliberately have no browser or Node dependencies. */
export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated?: string;
}

export interface Area {
  area_id: string;
  name: string;
  floor_id?: string | null;
  icon?: string | null;
  [key: string]: unknown;
}

export interface Device {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  area_id?: string | null;
  parent_device_id?: string | null;
  via_device_id?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  [key: string]: unknown;
}

export interface EntityRegistryEntry {
  entity_id: string;
  device_id?: string | null;
  area_id?: string | null;
  name?: string | null;
  original_name?: string | null;
  entity_category?: 'config' | 'diagnostic' | string | null;
  disabled_by?: string | null;
  hidden_by?: string | null;
  platform?: string | null;
  unique_id?: string | null;
  [key: string]: unknown;
}

export interface Snapshot {
  states: HassEntity[];
  areas: Area[];
  devices: Device[];
  entities: EntityRegistryEntry[];
  sceneConfigs?: Record<string, Record<string, unknown>>;
  sceneArtwork?: Record<string, { colors: string[]; dark?: boolean }>;
  pendingEntityIds?: string[];
  pendingSince?: Record<string, number>;
  services: Record<string, Record<string, unknown>>;
  config: {
    location_name: string;
    version?: string;
    unit_system?: { temperature: string };
    [key: string]: unknown;
  };
  user: { name: string; is_admin: boolean; [key: string]: unknown };
}

export interface HausAction {
  domain: string;
  service: string;
  target: { entity_id: string };
  service_data?: Record<string, unknown>;
}
