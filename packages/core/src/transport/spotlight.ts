/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface SpotlightCategoryInput {
  readonly id: string;
  readonly name: string;
}

export interface SpotlightRoomInput {
  readonly id: string;
  readonly name: string;
  readonly deviceCount: number;
}

export interface SpotlightCameraInput {
  readonly id: string;
  readonly name: string;
  readonly available?: boolean;
}

export interface SpotlightSceneInput {
  readonly id: string;
  readonly name: string;
}

export interface SpotlightDeviceInput {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly areaId?: string;
  readonly primaryEntityId: string;
}

export type SpotlightTarget =
  | { readonly kind: 'category'; readonly id: string; readonly name: string }
  | { readonly kind: 'room'; readonly id: string; readonly name: string }
  | { readonly kind: 'camera'; readonly id: string; readonly name: string }
  | { readonly kind: 'scene'; readonly id: string; readonly name: string }
  | { readonly kind: 'device'; readonly id: string; readonly name: string; readonly areaId?: string };

export interface SpotlightCatalogEntry {
  readonly key: string;
  readonly group: 'Favorites' | 'Categories' | 'Rooms' | 'Cameras' | 'Scenes' | 'Devices';
  readonly title: string;
  readonly subtitle: string;
  readonly favorite?: boolean;
  readonly target: SpotlightTarget;
}

export function searchHomeCatalog({
  query,
  rooms,
  categories,
  accessories,
  cameras,
  scenes,
  favoriteIds,
  limit = 40,
}: {
  readonly query: string;
  readonly rooms: readonly SpotlightRoomInput[];
  readonly categories: readonly SpotlightCategoryInput[];
  readonly accessories: readonly SpotlightDeviceInput[];
  readonly cameras: readonly SpotlightCameraInput[];
  readonly scenes: readonly SpotlightSceneInput[];
  readonly favoriteIds?: ReadonlySet<string>;
  readonly limit?: number;
}): SpotlightCatalogEntry[] {
  const term = query.trim().toLocaleLowerCase();
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
  const entries: SpotlightCatalogEntry[] = [];

  for (const cat of categories) {
    if (!term || cat.name.toLocaleLowerCase().includes(term)) {
      entries.push({
        key: `cat-${cat.id}`,
        group: 'Categories',
        title: cat.name,
        subtitle: 'Category',
        target: { kind: 'category', id: cat.id, name: cat.name },
      });
    }
  }

  for (const room of rooms) {
    if (!term || room.name.toLocaleLowerCase().includes(term)) {
      entries.push({
        key: `room-${room.id}`,
        group: 'Rooms',
        title: room.name,
        subtitle: `${room.deviceCount} ${room.deviceCount === 1 ? 'device' : 'devices'}`,
        target: { kind: 'room', id: room.id, name: room.name },
      });
    }
  }

  for (const cam of cameras) {
    if (!term || cam.name.toLocaleLowerCase().includes(term)) {
      entries.push({
        key: `camera-${cam.id}`,
        group: 'Cameras',
        title: cam.name,
        subtitle: cam.available === false ? 'Offline camera' : 'Camera',
        target: { kind: 'camera', id: cam.id, name: cam.name },
      });
    }
  }

  for (const scene of scenes) {
    if (!term || scene.name.toLocaleLowerCase().includes(term)) {
      entries.push({
        key: `scene-${scene.id}`,
        group: 'Scenes',
        title: scene.name,
        subtitle: 'Scene',
        target: { kind: 'scene', id: scene.id, name: scene.name },
      });
    }
  }

  for (const item of accessories) {
    const roomName = (item.areaId && roomNames.get(item.areaId)) || 'Home';
    const favorite = Boolean(favoriteIds?.has(item.primaryEntityId));
    const haystack = `${item.name} ${roomName} ${item.category}`.toLocaleLowerCase();
    if (!term || haystack.includes(term)) {
      entries.push({
        key: `device-${item.id}`,
        group: favorite && !term ? 'Favorites' : 'Devices',
        title: item.name,
        subtitle: roomName,
        favorite,
        target: { kind: 'device', id: item.id, name: item.name, areaId: item.areaId },
      });
    }
  }

  return entries.slice(0, limit);
}
