import type { ContextMenuItem } from '../../../../shared/native';
import type { ServerDevicePreference } from '../../model/preferences';
import type { ServerRoom } from './server-rooms';

export function serverContextItems(
  rooms: ServerRoom[],
  preference: ServerDevicePreference = {},
  editable = true,
): ContextMenuItem[] {
  const roomItems: ContextMenuItem[] = rooms
    .filter((room) => room.id !== 'unassigned' && room.id !== '')
    .map((room) => ({
      id: `move-room:${room.id}`,
      label: room.name,
      enabled: room.id !== preference.areaId,
    }));
  roomItems.push({
    id: 'move-room:unassigned',
    label: 'Unassigned',
    enabled: Boolean(preference.areaId),
  });
  return [
    { id: 'details', label: 'Server Details…' },
    {
      id: 'move-room',
      label: 'Move to Room',
      type: 'submenu',
      enabled: editable,
      items: roomItems,
    },
    {
      id: 'favorite',
      label: preference.favorite ? 'Remove from Favorites' : 'Add to Favorites',
      enabled: editable,
    },
    {
      id: 'home-visibility',
      label: preference.homeHidden ? 'Show on Home View' : 'Hide from Home View',
      enabled: editable,
    },
    {
      id: 'app-visibility',
      label: preference.appHidden ? 'Restore to Haus' : 'Hide from Haus',
      enabled: editable,
    },
  ];
}

/** A menu action updates only its preference and retains the remaining identity. */
export function serverContextPreference(
  selected: string,
  rooms: ServerRoom[],
  preference: ServerDevicePreference = {},
): ServerDevicePreference | undefined {
  if (selected.startsWith('move-room:')) {
    const areaId = selected.slice('move-room:'.length);
    if (areaId !== 'unassigned' && !rooms.some((room) => room.id === areaId)) return;
    return { ...preference, areaId: areaId === 'unassigned' ? '' : areaId };
  } else if (selected === 'favorite') {
    return { ...preference, favorite: !preference.favorite };
  } else if (selected === 'home-visibility') {
    return { ...preference, homeHidden: !preference.homeHidden };
  } else if (selected === 'app-visibility') {
    return { ...preference, appHidden: !preference.appHidden };
  }
}
