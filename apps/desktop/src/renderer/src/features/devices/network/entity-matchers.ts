/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  canonicalEntityDomain,
  canonicalEntityId,
  canonicalEntityObjectId,
  classifyNetworkStates,
  findQrImageEntities,
  findUpdateEntities,
  friendlyEntityLabel,
  type ClassifiedNetworkStates,
} from '@haus/core/transport';
import type { HassEntity, HausAccessory } from '../../../model';

export const canonicalHaEntityId = (entity: HassEntity): string => canonicalEntityId(entity);
export const canonicalDomain = (entity: HassEntity): string => canonicalEntityDomain(entity);
export const canonicalObjectId = (entity: HassEntity): string => canonicalEntityObjectId(entity);
export { friendlyEntityLabel };

export type ClassifiedNetworkEntities = ClassifiedNetworkStates<HassEntity>;

export function findDeviceUpdateEntities(accessory: HausAccessory): readonly HassEntity[] {
  return findUpdateEntities([accessory.state, ...accessory.secondaryEntities]);
}

export function findDeviceQrImageEntities(accessory: HausAccessory): readonly HassEntity[] {
  return findQrImageEntities([accessory.state, ...accessory.secondaryEntities]);
}

export function classifyNetworkEntities(accessory: HausAccessory): ClassifiedNetworkEntities {
  return classifyNetworkStates(accessory.state, accessory.secondaryEntities);
}
