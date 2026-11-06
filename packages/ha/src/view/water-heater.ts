/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HausAccessory, Snapshot } from './types.js';

export function isKettle(accessory: Pick<HausAccessory, 'model' | 'state'>) {
  return /\bkettle\b/i.test(`${accessory.model ?? ''} ${accessory.state.attributes.icon ?? ''}`);
}

export function heaterModeLabel(mode: string, kettle: boolean) {
  if (kettle && mode === 'electric') return 'Heat';
  if (kettle && mode === 'performance') return 'Boil';
  return mode.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function kettleHasActiveTarget(mode: string) {
  return mode === 'electric' || mode === 'performance';
}

export function knownTemperature(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Only the bridge's exact diagnostic is safe to present as a read-only refresh. */
export function kettleRefreshEntity(accessory: HausAccessory, snapshot: Snapshot) {
  if (!isKettle(accessory) || !snapshot.services.button?.press) return;
  const primary = snapshot.entities.find((entry) => entry.entity_id === accessory.primaryEntityId);
  const uniqueId = typeof primary?.unique_id === 'string' ? primary.unique_id : '';
  if (
    primary?.platform !== 'mqtt' ||
    !primary.device_id ||
    !/^haus_kettle_.+_kettle$/.test(uniqueId)
  )
    return;
  const refreshId = uniqueId.replace(/_kettle$/, '_refresh');
  const registry = snapshot.entities.find(
    (entry) =>
      entry.platform === 'mqtt' &&
      entry.device_id === primary.device_id &&
      entry.unique_id === refreshId &&
      entry.entity_id.startsWith('button.') &&
      !entry.disabled_by &&
      !entry.hidden_by,
  );
  return snapshot.states.find((entity) => entity.entity_id === registry?.entity_id);
}
