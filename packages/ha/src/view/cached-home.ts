/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Snapshot } from './types.js';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Cached topology is readable context, never proof that a device is online. */
export function cachedHomeSnapshot(value: unknown): Snapshot | undefined {
  if (
    !record(value) ||
    !record(value.config) ||
    !record(value.services) ||
    !record(value.user) ||
    typeof value.config.location_name !== 'string' ||
    typeof value.user.name !== 'string' ||
    typeof value.user.is_admin !== 'boolean'
  )
    return;
  for (const [key, id] of [
    ['states', 'entity_id'],
    ['entities', 'entity_id'],
    ['devices', 'id'],
    ['areas', 'area_id'],
  ] as const) {
    const items = value[key];
    if (
      !Array.isArray(items) ||
      items.length > 30000 ||
      items.some((item) => !record(item) || typeof item[id] !== 'string')
    )
      return;
  }
  if (
    (value.states as unknown[]).some(
      (item) => !record(item) || typeof item.state !== 'string' || !record(item.attributes),
    )
  )
    return;
  return value as unknown as Snapshot;
}
