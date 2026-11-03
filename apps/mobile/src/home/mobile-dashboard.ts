/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { buildHomeView } from '@haus/core/home-model/home-view';
import { normalizeHome } from '@haus/core/home-model/normalize';
import { defaults, type Preferences } from '@haus/core/home-model/preferences';
import { describeAccessory } from '@haus/core/home-model/presentation';
import { groupNumberedLights, orderRoomDevices } from '@haus/core/home-model/room-devices';
import { scenePresentation } from '@haus/core/home-model/scene-presentation';
import { categories } from '@haus/core/home-model/categories';
import type { Snapshot } from '@haus/core/types';

export interface MobileHomeItem {
  id: string;
  kind: 'device' | 'scene';
  name: string;
  category: string;
  state: string;
  available: boolean;
  favorite: boolean;
}
export interface MobileHomeSection {
  key: string;
  title: string;
  data: MobileHomeItem[];
}

/** Desktop and mobile share physical grouping, proxy filtering, visibility and saved ordering. */
export function createMobileDashboardProjection() {
  let previous: MobileHomeSection[] = [];
  return (snapshot: Snapshot | null, preferences: Preferences = defaults): MobileHomeSection[] => {
    if (!snapshot) return (previous = []);
    const model = normalizeHome(snapshot);
    const view = buildHomeView({
      model,
      snapshot,
      preferences,
      route: { kind: 'home' },
      search: '',
      selectedLightGroup: null,
    });
    const oldSections = new Map(previous.map((section) => [section.key, section]));
    const oldItems = new Map(
      previous.flatMap((section) => section.data.map((item) => [item.id, item])),
    );
    const stableItem = (item: MobileHomeItem) => {
      const old = oldItems.get(item.id);
      return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
    };
    const sections: MobileHomeSection[] = [];
    if (view.sortedHomeScenes.length)
      sections.push({
        key: 'scenes',
        title: 'Scenes',
        data: view.sortedHomeScenes.map((scene) =>
          stableItem({
            id: scene.entity_id,
            kind: 'scene',
            name: scenePresentation(scene).name,
            category: 'Scene',
            state: 'Scene',
            available: scene.state !== 'unavailable',
            favorite: preferences.favorites.includes(scene.entity_id),
          }),
        ),
      });
    for (const room of view.homeRooms) {
      const scope = `home:room:${room.id}`;
      const items = groupNumberedLights(
        room.accessories,
        preferences.autoGroupLights !== false,
        preferences.disabledLightGroups,
      );
      sections.push({
        key: room.id,
        title: room.name,
        data: orderRoomDevices(items, preferences, preferences.deviceOrder?.[scope]).map((item) =>
          stableItem({
            id: item.id,
            kind: 'device',
            name: item.name,
            category: categories.find((category) => category.id === item.category)?.name ?? '',
            state: describeAccessory(item),
            available: item.availability === 'available',
            favorite: view.isFavorite(item),
          }),
        ),
      });
    }
    const stable = sections.map((section) => {
      const old = oldSections.get(section.key);
      return old &&
        old.title === section.title &&
        old.data.length === section.data.length &&
        old.data.every((item, index) => item === section.data[index])
        ? old
        : section;
    });
    if (
      stable.length === previous.length &&
      stable.every((section, index) => section === previous[index])
    )
      return previous;
    return (previous = stable);
  };
}
