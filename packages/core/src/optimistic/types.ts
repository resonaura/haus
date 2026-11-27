/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export const OPTIMISTIC_TIMEOUT_NOTICE =
  'Device confirmation is taking longer than expected. Showing the latest reported state.';

export interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated?: string;
}

export interface EntityRegistryRecord {
  entity_id: string;
  haus_id?: string | null;
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

export interface EntitySnapshot {
  states: EntityState[];
  entities: EntityRegistryRecord[];
  sceneConfigs?: Record<string, Record<string, unknown>>;
  pendingEntityIds?: string[];
  pendingSince?: Record<string, number>;
  config: {
    unit_system?: { temperature: string };
    [key: string]: unknown;
  };
}

export interface EntityAction {
  domain: string;
  service: string;
  target: { entity_id: string };
  service_data?: Record<string, unknown>;
}
