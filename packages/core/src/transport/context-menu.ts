/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { TransportAreaEntry } from './contract.js';

export interface ContextMenuOption {
  readonly id: string;
  readonly label: string;
  readonly type?: 'normal' | 'separator' | 'submenu';
  readonly enabled?: boolean;
  readonly items?: ContextMenuOption[];
}

export interface DeviceMenuInput {
  readonly primaryEntityId: string;
  readonly areaId?: string;
  readonly capabilities: readonly string[];
  readonly isActive: boolean;
  readonly available: boolean;
  readonly isLightGroup: boolean;
  readonly managementUrl?: string;
  readonly areas: readonly TransportAreaEntry[];
  readonly isAdmin: boolean;
  readonly isFavorite: boolean;
  readonly isHomeHidden: boolean;
  readonly isAppHidden: boolean;
}

export function resolveMoveRoomAreaId(actionId: string): string | null | undefined {
  if (!actionId.startsWith('move-room:')) return undefined;
  const raw = actionId.slice('move-room:'.length);
  return raw === 'unassigned' ? null : raw;
}

export function buildDeviceMenuOptions(input: DeviceMenuInput): ContextMenuOption[] {
  const domain = input.primaryEntityId.split('.')[0];
  const quickLabel = input.capabilities.includes('toggle')
    ? input.isActive
      ? 'Turn Off'
      : 'Turn On'
    : ['scene', 'script'].includes(domain)
      ? 'Run'
      : ['button', 'input_button'].includes(domain) && input.capabilities.includes('press')
        ? 'Press'
        : undefined;

  const areaItems: ContextMenuOption[] = [
    ...input.areas.map((area) => ({
      id: `move-room:${area.area_id}`,
      label: area.name,
      enabled: area.area_id !== input.areaId,
    })),
    {
      id: 'move-room:unassigned',
      label: 'Unassigned',
      enabled: input.areaId !== undefined,
    },
  ];

  return [
    ...(input.managementUrl
      ? [
          { id: 'open-browser', label: 'Open in Browser' },
          { id: 'sep0', label: '', type: 'separator' as const },
        ]
      : []),
    ...(quickLabel
      ? [
          { id: 'quick', label: quickLabel, enabled: input.available },
          { id: 'sep1', label: '', type: 'separator' as const },
        ]
      : []),
    { id: 'details', label: 'Accessory Details...' },
    ...(input.isLightGroup ? [{ id: 'ungroup', label: 'Show Lights Separately' }] : []),
    {
      id: 'move-room',
      label: 'Move to Room',
      type: 'submenu',
      enabled: input.isAdmin,
      items: areaItems,
    },
    { id: 'favorite', label: input.isFavorite ? 'Remove from Favorites' : 'Add to Favorites' },
    { id: 'sep2', label: '', type: 'separator' as const },
    { id: 'toggle-home', label: input.isHomeHidden ? 'Show on Home View' : 'Hide from Home View' },
    { id: 'hide-app', label: input.isAppHidden ? 'Restore to Haus' : 'Hide from Haus' },
  ];
}

export function buildSceneMenuOptions({
  isHomeHidden,
  isAppHidden,
  canEdit = true,
}: {
  readonly isHomeHidden: boolean;
  readonly isAppHidden: boolean;
  readonly canEdit?: boolean;
}): ContextMenuOption[] {
  return [
    { id: 'run', label: 'Apply Scene' },
    { id: 'details', label: 'Scene Details...' },
    { id: 'edit', label: 'Edit Scene…', enabled: canEdit },
    { id: 'sep', label: '', type: 'separator' },
    { id: 'toggle-home', label: isHomeHidden ? 'Show on Home View' : 'Hide from Home View' },
    { id: 'hide-app', label: isAppHidden ? 'Restore to Haus' : 'Hide from Haus' },
  ];
}

export function buildCameraMenuOptions({
  isHomeHidden,
  isAppHidden,
  index = 0,
  total = 0,
}: {
  readonly isHomeHidden: boolean;
  readonly isAppHidden: boolean;
  readonly index?: number;
  readonly total?: number;
}): ContextMenuOption[] {
  const reorderItems: ContextMenuOption[] =
    total > 1
      ? [
          { id: 'earlier', label: 'Move Earlier', enabled: index > 0 },
          { id: 'later', label: 'Move Later', enabled: index < total - 1 },
        ]
      : [];
  return [
    { id: 'details', label: 'Camera Details…' },
    ...reorderItems,
    { id: 'separator', label: '', type: 'separator' },
    { id: 'toggle-home', label: isHomeHidden ? 'Show on Home View' : 'Hide from Home View' },
    { id: 'hide-app', label: isAppHidden ? 'Restore to Haus' : 'Hide from Haus' },
  ];
}
