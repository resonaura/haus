/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { buildAction } from '@haus/ha/view/controls/action';
import { categories } from '@haus/ha/view/categories';
import { stripOutlets } from '@haus/ha/view/device-relationships';
import { resolveDeviceAppearance } from '@haus/ha/view/device-state';
import { buildHomeView } from '@haus/ha/view/home-view';
import { normalizeHome } from '@haus/ha/view/normalize';
import { CAMERA_ORDER_SCOPE, defaults, type Preferences } from '@haus/core/preferences';
import { describeAccessory } from '@haus/ha/view/presentation';
import { groupNumberedLights, orderRoomDevices } from '@haus/ha/view/room-devices';
import { scenePresentation, sortScenesByName } from '@haus/ha/view/scene-presentation';
import type { HausAction, Snapshot } from '@haus/ha/types';
import type { HausAccessory } from '@haus/ha/view/types';
import type { DeviceTileData } from '@haus/ui/components';

export interface MobileHomeItem extends DeviceTileData {
  id: string;
  kind: 'device' | 'scene' | 'room' | 'camera';
  accentCss?: string;
  quickActions?: readonly HausAction[];
}
export interface MobileHomeSection {
  key: string;
  title: string;
  data: MobileHomeItem[];
}
export type MobileDestination = 'home' | 'rooms' | 'scenes';

export const MOBILE_DESTINATIONS = [
  { id: 'home', label: 'Home' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'scenes', label: 'Scenes' },
] as const;

export function mobileDashboardSignature(sections: readonly MobileHomeSection[]): string {
  return sections
    .map((section) => `${section.key}:${section.data.map((item) => item.id).join(',')}`)
    .join('|');
}

export function mobileConnectionStatus(connection: string): string {
  if (connection === 'connected') return 'Connected';
  if (connection === 'reconnecting' || connection === 'connecting') return 'Reconnecting';
  if (connection === 'auth-required') return 'Sign in again to reconnect';
  return 'Your home is offline';
}

export function safeMobileError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Could not connect to your home.';
}

function isServiceAvailable(snapshot: Snapshot, action: HausAction): boolean {
  return Object.hasOwn(snapshot.services[action.domain] ?? {}, action.service);
}

function resolveAccessoryQuickActions(
  snapshot: Snapshot,
  accessory: HausAccessory,
): readonly HausAction[] | undefined {
  if (accessory.availability !== 'available' || accessory.powerStrip || accessory.managementUrl) {
    return undefined;
  }
  if (accessory.lightGroup) {
    const raw = accessory.lightGroup.members.flatMap((member) => {
      try {
        const action = buildAction(member.state, 'toggle');
        return isServiceAvailable(snapshot, action) ? [action] : [];
      } catch {
        return [];
      }
    });
    if (!raw.length) return undefined;
    const service = raw.some((action) => action.service === 'turn_off') ? 'turn_off' : 'turn_on';
    const aligned = raw.flatMap((action) =>
      Object.hasOwn(snapshot.services[action.domain] ?? {}, service)
        ? [{ ...action, service }]
        : [],
    );
    return aligned.length ? aligned : undefined;
  }
  const intent = accessory.capabilities.includes('toggle')
    ? 'toggle'
    : accessory.capabilities.includes('press')
      ? 'press'
      : undefined;
  if (!intent) return undefined;
  try {
    const action = buildAction(accessory.state, intent);
    return isServiceAvailable(snapshot, action) ? [action] : undefined;
  } catch {
    return undefined;
  }
}

/** Desktop and mobile share physical grouping, proxy filtering, visibility, ordering, and optimistic state. */
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
        data: scenes.map((scene) => {
          const pending = snapshot.pendingEntityIds?.includes(scene.entity_id) === true;
          const pendingSince = snapshot.pendingSince?.[scene.entity_id];
          const available = scene.state !== 'unavailable';
          const canRun = available && Object.hasOwn(snapshot.services.scene ?? {}, 'turn_on');
          return stableItem({
            id: scene.entity_id,
            kind: 'scene',
            name: scenePresentation(scene).name,
            categoryLabel: 'Scene',
            state: pending ? 'Applying…' : 'Scene',
            available,
            active: pending,
            pending: pending || undefined,
            pendingSince,
            favorite: preferences.favorites.includes(scene.entity_id),
            quickActions: canRun
              ? [{ domain: 'scene', service: 'turn_on', target: { entity_id: scene.entity_id } }]
              : undefined,
          });
        }),
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
      const roomSaved = preferences.deviceOrder?.[scope] ?? [];
      const cameraSaved = preferences.deviceOrder?.[CAMERA_ORDER_SCOPE] ?? [];
      const savedOrder = cameraSaved.length ? [...roomSaved, ...cameraSaved] : roomSaved;
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
        data: orderRoomDevices(items, preferences, savedOrder).map((item) => {
          const outlets = item.powerStrip ? stripOutlets(item) : [];
          const effectiveState = item.powerStrip
            ? {
                ...item.state,
                state: outlets.some((outlet) => outlet.state === 'on') ? 'on' : 'off',
              }
            : item.state;
          const appearance = resolveDeviceAppearance(effectiveState);
          const available = item.availability === 'available';
          const active = available && appearance.active;
          const quickActions = resolveAccessoryQuickActions(snapshot, item);
          return stableItem({
            id: item.id,
            kind: 'device',
            name: item.name,
            category: item.category,
            categoryLabel: categories.find((category) => category.id === item.category)?.name,
            state: describeAccessory(item),
            available,
            active: active || undefined,
            pending: item.pending || undefined,
            pendingSince: item.pendingSince,
            accentCss: active ? appearance.actualColor : undefined,
            favorite: view.isFavorite(item),
            quickActions,
          });
        }),
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
