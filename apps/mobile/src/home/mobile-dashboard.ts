/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { buildHomeView } from '@haus/ha/view/home-view';
import { normalizeHome } from '@haus/ha/view/normalize';
import { defaults, type Preferences } from '@haus/ha/view/preferences';
import { describeAccessory } from '@haus/ha/view/presentation';
import { groupNumberedLights, orderRoomDevices } from '@haus/ha/view/room-devices';
import { scenePresentation, sortScenesByName } from '@haus/ha/view/scene-presentation';
import { categories } from '@haus/ha/view/categories';
import type { Snapshot } from '@haus/ha/types';

export interface MobileHomeItem {
  id: string;
  kind: 'device' | 'scene' | 'room';
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
export type MobileDestination = 'home' | 'rooms' | 'scenes';

/** Desktop and mobile share physical grouping, proxy filtering, visibility and saved ordering. */
export function createMobileDashboardProjection() {
  let previous: MobileHomeSection[] = [];
  return (
    snapshot: Snapshot | null,
    preferences: Preferences = defaults,
    destination: MobileDestination = 'home',
    roomId?: string,
  ): MobileHomeSection[] => {
    if (!snapshot) return (previous = []);
    const model = normalizeHome(snapshot);
    const view = buildHomeView({
      model,
      snapshot,
      preferences,
      route: { kind: destination },
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
    const selectedRoom =
      destination === 'rooms' && roomId
        ? view.navigationRooms.find((item) => item.id === roomId)
        : undefined;
    const scenes =
      destination === 'home'
        ? view.sortedHomeScenes
        : destination === 'scenes'
          ? sortScenesByName(view.appScenes)
          : selectedRoom
            ? sortScenesByName(view.scenesForRoom(selectedRoom.id))
            : [];
    if (scenes.length)
      sections.push({
        key: 'scenes',
        title: 'Scenes',
        data: scenes.map((scene) =>
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
    if (destination === 'rooms' && !roomId && view.navigationRooms.length) {
      sections.push({
        key: 'room-directory',
        title: 'Rooms',
        data: view.navigationRooms.map((item) =>
          stableItem({
            id: item.id,
            kind: 'room',
            name: item.name,
            category: '',
            state: '',
            available: true,
            favorite: false,
          }),
        ),
      });
    }
    for (const room of destination === 'home'
      ? view.homeRooms
      : selectedRoom
        ? [selectedRoom]
        : []) {
      const scope = destination === 'home' ? `home:room:${room.id}` : `room:${room.id}:all`;
      const items = groupNumberedLights(
        destination === 'home'
          ? room.accessories
          : room.accessories.filter((item) => !view.appHidden(item)),
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
