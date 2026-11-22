/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { entityDomain, resolveCapabilities } from './capabilities.js';
import { categoryEntityRank, entityCategory, secondaryEntityCategory } from './matchers.js';
import type {
  Category,
  EntityRegistryEntry,
  HassEntity,
  HausAccessory,
  Snapshot,
} from './types.js';

export const categories: { id: Category; name: string }[] = [
  { id: 'climate', name: 'Climate' },
  { id: 'lights', name: 'Lights' },
  { id: 'security', name: 'Security' },
  { id: 'media', name: 'Speakers & TVs' },
  { id: 'water', name: 'Water' },
  { id: 'outlets', name: 'Sockets' },
  { id: 'covers', name: 'Covers' },
  { id: 'printers', name: 'Printers' },
  { id: 'network', name: 'Network' },
  { id: 'appliances', name: 'Appliances' },
  { id: 'robotics', name: 'Robotics' },
  { id: 'sensors', name: 'Sensors' },
  { id: 'other', name: 'Other devices' },
];

const categoryOrder = new Map<Category, number>(
  categories.map((category, index) => [category.id, index]),
);

export function resolveAccessoryCategories(
  primary: HassEntity,
  primaryCategory: Category,
  secondaryEntities: readonly HassEntity[],
  registry: ReadonlyMap<string, EntityRegistryEntry>,
): { categories: Category[]; categoryEntities?: Partial<Record<Category, string>> } {
  const bestByCategory = new Map<Category, { entityId: string; rank: number }>();
  for (const entity of secondaryEntities) {
    const trait = secondaryEntityCategory(
      entity,
      registry.get(entity.entity_id),
      primary,
      primaryCategory,
    );
    if (!trait || trait === primaryCategory) continue;
    const rank = categoryEntityRank(entity);
    const current = bestByCategory.get(trait);
    if (
      !current ||
      rank < current.rank ||
      (rank === current.rank && entity.entity_id.localeCompare(current.entityId) < 0)
    ) {
      bestByCategory.set(trait, { entityId: entity.entity_id, rank });
    }
  }
  const extraCategories = [...bestByCategory.keys()].sort(
    (a, b) => (categoryOrder.get(a) ?? 99) - (categoryOrder.get(b) ?? 99),
  );
  if (!extraCategories.length) return { categories: [primaryCategory] };
  const categoryEntities: Partial<Record<Category, string>> = {};
  for (const cat of extraCategories) {
    categoryEntities[cat] = bestByCategory.get(cat)!.entityId;
  }
  return {
    categories: [primaryCategory, ...extraCategories],
    categoryEntities,
  };
}

export const accessoryCategories = (accessory: HausAccessory): readonly Category[] =>
  accessory.categories?.length ? accessory.categories : [accessory.category];

export const accessoryMatchesCategory = (accessory: HausAccessory, categoryId: string): boolean =>
  accessory.category === categoryId ||
  Boolean(accessory.categories?.includes(categoryId as Category));

export function categoryEntityFor(accessory: HausAccessory, categoryId: string): HassEntity {
  if (accessory.category === categoryId) return accessory.state;
  const targetId = accessory.categoryEntities?.[categoryId as Category];
  if (!targetId) return accessory.state;
  return (
    accessory.secondaryEntities.find((entity) => entity.entity_id === targetId) ?? accessory.state
  );
}

/**
 * Projects a multi-characteristic accessory onto the entity relevant to a selected
 * category lens while keeping its canonical `id`, `entityIds`, and visibility scope.
 */
export function projectAccessoryForCategory(
  accessory: HausAccessory,
  categoryId: string,
  services?: Snapshot['services'],
): HausAccessory {
  if (accessory.category === categoryId) return accessory;
  const target = categoryEntityFor(accessory, categoryId);
  if (target.entity_id === accessory.state.entity_id) return accessory;
  const otherEntities = [
    accessory.state,
    ...accessory.secondaryEntities.filter((entity) => entity.entity_id !== target.entity_id),
  ];
  return {
    ...accessory,
    primaryEntityId: target.entity_id,
    category: categoryId as Category,
    state: target,
    secondaryEntities: otherEntities,
    availability:
      target.state === 'unavailable'
        ? 'unavailable'
        : target.state === 'unknown'
          ? 'unknown'
          : 'available',
    capabilities: services ? resolveCapabilities(target, services) : [],
    powerStrip: undefined,
    buttonController: undefined,
    physicalHub: undefined,
    managementUrl: undefined,
  };
}

export function projectAccessoryEntity(
  accessory: HausAccessory,
  entity: HassEntity,
): HausAccessory {
  if (entity.entity_id === accessory.state.entity_id) return accessory;
  return {
    ...accessory,
    primaryEntityId: entity.entity_id,
    category: entityCategory(entity),
    state: entity,
    powerStrip: undefined,
    buttonController: undefined,
    physicalHub: undefined,
    managementUrl: undefined,
  };
}

export function accessoriesForCategory(
  accessories: readonly HausAccessory[],
  categoryId: string,
  options?: { services?: Snapshot['services']; excludeCameras?: boolean },
): HausAccessory[] {
  const projected = accessories
    .filter((accessory) => accessoryMatchesCategory(accessory, categoryId))
    .map((accessory) => projectAccessoryForCategory(accessory, categoryId, options?.services));
  return options?.excludeCameras
    ? projected.filter((accessory) => entityDomain(accessory.state) !== 'camera')
    : projected;
}
